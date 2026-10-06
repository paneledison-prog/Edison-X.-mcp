import { SourceError } from "../errors.js";
import { decryptString, deriveKey, encryptString } from "../security/crypto.js";
import { PinterestClient, type TokenResponse } from "../sources/pinterest/client.js";
import type { Repository } from "../storage/repository.js";
import type { OAuthProvider } from "./oauth.js";

export const PINTEREST_SOURCE = "pinterest";
export const PINTEREST_SCOPES = ["boards:read", "pins:read"] as const;
const AUTHORIZE_URL = "https://www.pinterest.com/oauth/";
const REFRESH_SKEW_MS = 60_000;

/**
 * Per-user Pinterest connections. Tokens are encrypted at rest (AES-256-GCM, key derived from the
 * master key and never stored in the database), refreshed before they expire, and deleted on disconnect.
 */
export class PinterestConnections implements OAuthProvider {
  readonly source = PINTEREST_SOURCE;
  private readonly key: Buffer;
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    private readonly repo: Repository,
    private readonly client: PinterestClient,
    private readonly cfg: { clientId: string; redirectUri: string },
    masterKey: string,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.key = deriveKey(masterKey, "oauth-tokens");
  }

  authorizeUrl(state: string): string {
    const qs = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: "code",
      scope: PINTEREST_SCOPES.join(","),
      state,
    });
    return `${AUTHORIZE_URL}?${qs.toString()}`;
  }

  private store(
    principalId: string,
    t: TokenResponse,
    previous?: { refreshTokenEnc: string | null; createdAt: string },
  ): void {
    const now = this.clock();
    this.repo.upsertConnection({
      principalId,
      source: PINTEREST_SOURCE,
      accessTokenEnc: encryptString(this.key, t.access_token),
      refreshTokenEnc: t.refresh_token
        ? encryptString(this.key, t.refresh_token)
        : (previous?.refreshTokenEnc ?? null),
      expiresAt: t.expires_in ? new Date(now.getTime() + t.expires_in * 1000).toISOString() : null,
      scope: t.scope ?? null,
      createdAt: previous?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  async exchange(code: string, principalId: string): Promise<void> {
    this.store(principalId, await this.client.exchangeCode(code), undefined);
  }

  isConnected(principalId: string): boolean {
    return this.repo.getConnection(principalId, PINTEREST_SOURCE) !== null;
  }

  /** A valid access token, refreshed first if it expires within a minute. Throws `not_connected` if there is none. */
  getAccessToken(principalId: string, signal?: AbortSignal): Promise<string> {
    const conn = this.repo.getConnection(principalId, PINTEREST_SOURCE);
    if (!conn) throw new SourceError(PINTEREST_SOURCE, "not_connected");
    const expiresSoon =
      conn.expiresAt !== null && Date.parse(conn.expiresAt) - this.clock().getTime() < REFRESH_SKEW_MS;
    if (!expiresSoon) return Promise.resolve(decryptString(this.key, conn.accessTokenEnc));
    return this.refresh(principalId, signal);
  }

  /** Force a refresh (also used after a 401). One refresh per principal at a time. */
  refresh(principalId: string, signal?: AbortSignal): Promise<string> {
    const inflight = this.refreshing.get(principalId);
    if (inflight) return inflight;
    const p = (async (): Promise<string> => {
      const conn = this.repo.getConnection(principalId, PINTEREST_SOURCE);
      if (!conn?.refreshTokenEnc) {
        await this.disconnect(principalId);
        throw new SourceError(PINTEREST_SOURCE, "not_connected");
      }
      try {
        const t = await this.client.refresh(decryptString(this.key, conn.refreshTokenEnc), signal);
        this.store(principalId, t, conn);
        return t.access_token;
      } catch (err) {
        if (err instanceof SourceError && err.reason === "unauthorized") {
          await this.disconnect(principalId);
          throw new SourceError(PINTEREST_SOURCE, "not_connected");
        }
        throw err;
      }
    })().finally(() => this.refreshing.delete(principalId));
    this.refreshing.set(principalId, p);
    return p;
  }

  /** Deletes the tokens and everything cached for this person from this source. */
  disconnect(principalId: string): Promise<void> {
    this.repo.deleteConnection(principalId, PINTEREST_SOURCE);
    this.repo.purgePrincipalSource(principalId, PINTEREST_SOURCE);
    return Promise.resolve();
  }
}
