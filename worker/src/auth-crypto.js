// Pure WebCrypto helpers shared by the Worker, node --test, and scripts/reset-password.mjs.
// No D1, no env access beyond what callers pass in. See docs/2026-11-12-auth-and-mcp-blueprint.md §4.

export const PBKDF2_MAX_ITERATIONS = 100_000; // Cloudflare Workers rejects higher counts
export const PBKDF2_MIN_ITERATIONS = 1_000; // floor for tests; production default is the max
export const SESSION_PREFIX = "tts_";
export const API_TOKEN_PREFIX = "ttp_";
const HASH_SCHEME = "pbkdf2-sha256";
const SALT_BYTES = 16;
const KEY_BITS = 256;
const encoder = new TextEncoder();

export const utf8 = (text) => encoder.encode(text);

export function b64urlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** 256-bit random opaque token with a type prefix ("tts_" session, "ttp_" API token). */
export const generateToken = (prefix) => `${prefix}${b64urlEncode(randomBytes(32))}`;

export async function sha256Hex(text) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time for equal lengths; length mismatch returns false (lengths are public here). */
export function constantTimeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Iteration count from env, clamped to what workerd accepts. */
export function resolveIterations(env) {
  const n = Number.parseInt(env?.AUTH_PBKDF2_ITERATIONS ?? "", 10);
  if (!Number.isFinite(n)) return PBKDF2_MAX_ITERATIONS;
  return Math.min(PBKDF2_MAX_ITERATIONS, Math.max(PBKDF2_MIN_ITERATIONS, n));
}

async function derive(password, pepper, salt, iterations) {
  const hmacKey = await crypto.subtle.importKey("raw", utf8(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const peppered = await crypto.subtle.sign("HMAC", hmacKey, utf8(String(password).normalize("NFKC")));
  const baseKey = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, baseKey, KEY_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password, pepper, { iterations = PBKDF2_MAX_ITERATIONS } = {}) {
  if (!pepper) throw new Error("AUTH_PEPPER is required to hash passwords");
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, pepper, salt, iterations);
  return `${HASH_SCHEME}$${iterations}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

export function parseHash(stored) {
  const parts = typeof stored === "string" ? stored.split("$") : [];
  if (parts.length !== 4 || parts[0] !== HASH_SCHEME) return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_MAX_ITERATIONS) return null;
  try {
    return { iterations, salt: b64urlDecode(parts[2]), hash: b64urlDecode(parts[3]) };
  } catch {
    return null;
  }
}

/** Well-formed hash that matches nothing: verify against it when the user does not exist (timing). */
export const dummyHash = (iterations = PBKDF2_MAX_ITERATIONS) =>
  `${HASH_SCHEME}$${iterations}$${b64urlEncode(new Uint8Array(SALT_BYTES))}$${b64urlEncode(new Uint8Array(KEY_BITS / 8))}`;

/** { ok, needsRehash }. needsRehash = matched but stored with a different iteration count. */
export async function verifyPassword(password, stored, pepper, { iterations: wanted = PBKDF2_MAX_ITERATIONS } = {}) {
  const parsed = parseHash(stored);
  if (!parsed || !pepper) return { ok: false, needsRehash: false };
  const candidate = await derive(password, pepper, parsed.salt, parsed.iterations);
  const ok = constantTimeEqual(candidate, parsed.hash);
  return { ok, needsRehash: ok && parsed.iterations !== wanted };
}
