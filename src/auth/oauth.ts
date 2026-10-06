import { AuthError, NotFoundError } from "../errors.js";
import type { AuditLog } from "../observability/audit.js";
import { randomToken, sha256Hex } from "../security/crypto.js";
import type { ConnectionRepository } from "../storage/repository.js";

/** One provider per source that needs a person's own account. */
export interface OAuthProvider {
  readonly source: string;
  authorizeUrl(state: string): string;
  /** Exchange the code and store encrypted tokens for the principal. */
  exchange(code: string, principalId: string): Promise<void>;
  /** Delete the principal's tokens and cached source data. */
  disconnect(principalId: string): Promise<void>;
}

const STATE_TTL_MS = 10 * 60 * 1000;

/** Generic, source-independent OAuth plumbing: single-use state bound to the principal who started it. */
export class OAuthService {
  constructor(
    private readonly repo: ConnectionRepository,
    private readonly audit: AuditLog,
    private readonly providers: ReadonlyMap<string, OAuthProvider>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  has(source: string): boolean {
    return this.providers.has(source);
  }

  private provider(source: string): OAuthProvider {
    const p = this.providers.get(source);
    if (!p) throw new NotFoundError("No connectable source has that id.");
    return p;
  }

  /** Returns the provider's authorize URL. The state is random, stored only as a hash, and single-use. */
  begin(source: string, principalId: string): string {
    const provider = this.provider(source);
    const state = randomToken(32);
    this.repo.saveOAuthState(sha256Hex(state), principalId, source, new Date(this.clock().getTime() + STATE_TTL_MS));
    return provider.authorizeUrl(state);
  }

  async complete(source: string, state: string, code: string): Promise<string> {
    const provider = this.provider(source);
    const rec = this.repo.consumeOAuthState(sha256Hex(state), this.clock());
    if (!rec || rec.source !== source) throw new AuthError("invalid or expired state");
    await provider.exchange(code, rec.principalId);
    this.audit.record("source_connected", rec.principalId, { source });
    return rec.principalId;
  }

  async disconnect(source: string, principalId: string): Promise<void> {
    await this.provider(source).disconnect(principalId);
    this.audit.record("source_disconnected", principalId, { source });
  }
}
