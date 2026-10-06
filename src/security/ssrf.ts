import { isIP } from "node:net";

/** SSRF guard primitives (Guidelines section 10, Rules/02-security.md). */

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet"];

function ipv4ToInt(ip: string): number {
  const p = ip.split(".").map(Number);
  return (((p[0] ?? 0) << 24) >>> 0) + ((p[1] ?? 0) << 16) + ((p[2] ?? 0) << 8) + (p[3] ?? 0);
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
  });
}

/** Expand an IPv6 address into eight 16-bit groups. Returns null if malformed. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  // Embedded IPv4 tail (e.g. ::ffff:1.2.3.4)
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (isIP(tail) !== 4) return null;
    const n = ipv4ToInt(tail);
    s = `${s.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = halves.length === 1 ? head : [...head, ...Array<string>(missing).fill("0"), ...rest];
  const out = groups.map((g) => parseInt(g, 16));
  if (out.length !== 8 || out.some((x) => Number.isNaN(x) || x < 0 || x > 0xffff)) return null;
  return out;
}

function isPrivateV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true; // unparsable: fail closed
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g6 = 0, h = 0] = g;
  if (g.every((x) => x === 0)) return true; // ::
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0 && g6 === 0 && h === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0xffff || f === 0)) {
    return isPrivateV4(`${g6 >> 8}.${g6 & 0xff}.${h >> 8}.${h & 0xff}`);
  }
  // NAT64 (64:ff9b::/96) embeds an IPv4 address
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) {
    return isPrivateV4(`${g6 >> 8}.${g6 & 0xff}.${h >> 8}.${h & 0xff}`);
  }
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (incl. fd00:ec2::254 metadata)
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((a & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return true; // discard prefix
  if (a === 0x2002) return true; // 6to4 (embeds IPv4; refuse)
  return false;
}

/** True for loopback, private, link-local, metadata, multicast, reserved and unparsable addresses. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip);
  return true;
}

export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (!h.includes(".")) return true; // single-label names are internal by definition
  return BLOCKED_SUFFIXES.some((s) => h.endsWith(s));
}

export type UrlRejection =
  | "invalid_url"
  | "not_https"
  | "credentials"
  | "ip_literal"
  | "blocked_host"
  | "bad_port"
  | "host_not_allowed";

export interface UrlCheckOptions {
  /** If given, the hostname must equal one of these or be a subdomain of one. */
  allowedHosts?: readonly string[];
}

export function hostMatches(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => {
    const x = a.toLowerCase();
    return h === x || h.endsWith(`.${x}`);
  });
}

/** Static URL checks (no DNS). Returns the parsed URL or the reason for rejection. */
export function checkUrl(input: string, opts: UrlCheckOptions = {}): { ok: true; url: URL } | { ok: false; reason: UrlRejection } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.port && url.port !== "443") return { ok: false, reason: "bad_port" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) return { ok: false, reason: "ip_literal" };
  if (isBlockedHostname(host)) return { ok: false, reason: "blocked_host" };
  if (opts.allowedHosts && !hostMatches(host, opts.allowedHosts)) return { ok: false, reason: "host_not_allowed" };
  return { ok: true, url };
}
