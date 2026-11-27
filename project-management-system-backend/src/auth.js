import { BRAND } from "../../project-management-system-frontend/src/data/brand";
// Password hashing (PBKDF2-SHA256) and session tokens. Stored hashes look like
// "pbkdf2$<iterations>$<salt hex>$<hash hex>"; seeds in migrations/ use the same format.
const ITERATIONS = 100_000; // the Workers runtime caps PBKDF2 at 100k
const enc = new TextEncoder();
const toHex =
  /** @param {ArrayBuffer | Uint8Array} buf
   * @returns {string}
   */ (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex =
  /** @param {string} hex
   * @returns {Uint8Array}
   */ (hex) => new Uint8Array(/** @type {RegExpMatchArray} */ (hex.match(/../g)).map((h) => parseInt(h, 16)));
/**
 * @param {string} password
 * @param {Uint8Array} salt
 * @param {number} iterations
 * @returns {Promise<string>}
 */
async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return toHex(bits);
}
/**
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${await derive(password, salt, ITERATIONS)}`;
}
/**
 * @param {string} password
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !salt || !hash) return false;
  const actual = await derive(password, fromHex(salt), Number(iter));
  // Constant-time comparison.
  let diff = actual.length ^ hash.length;
  for (let i = 0; i < Math.min(actual.length, hash.length); i++) diff |= actual.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
// Temporary passwords handed out by an administrator: readable, no look-alike characters.
const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
/**
 * @returns {string}
 */
export function tempPassword() {
  // Bytes at or above the largest multiple of the alphabet size are skipped, so every
  // character is equally likely.
  const limit = 256 - (256 % TEMP_ALPHABET.length);
  let chars = "";
  while (chars.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && chars.length < 12) chars += TEMP_ALPHABET.charAt(b % TEMP_ALPHABET.length);
    }
  }
  // The dashes are its symbols; make sure it has a letter and a number too, so even a
  // temporary password meets the policy (12+ characters with letters, numbers and symbols).
  if (!/\d/.test(chars) || !/[A-Za-z]/.test(chars)) return tempPassword();
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
/**
 * @returns {string}
 */
export const newToken = () => toHex(crypto.getRandomValues(new Uint8Array(32)));
/**
 * Sessions are stored by the SHA-256 of their token, so a leaked database can't be replayed.
 * @param {string} token
 * @returns {Promise<string>}
 */
export async function tokenHash(token) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(token)));
}
// ---------- Two-step verification (TOTP, RFC 6238) ----------
// Authenticator apps (Microsoft/Google Authenticator, 1Password, ...) show a 6-digit code that
// changes every 30 seconds, derived from a secret shared once at setup via a QR code.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP = 30;
/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
/**
 * @param {string} text
 * @returns {Uint8Array}
 */
function base32Decode(text) {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  /** @type {number[]} */ const out = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
/**
 * A new 160-bit secret, base32 as authenticator apps expect.
 * @returns {string}
 */
export const newTotpSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)));
/**
 * @param {string} secret
 * @param {number} counter
 * @returns {Promise<string>}
 */
async function hotp(secret, counter) {
  const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new DataView(new ArrayBuffer(8));
  msg.setUint32(0, Math.floor(counter / 2 ** 32));
  msg.setUint32(4, counter >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg.buffer));
  const off = mac[mac.length - 1] & 15;
  const n = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(n % 1_000_000).padStart(6, "0");
}
/**
 * Checks a 6-digit code against the current 30-second step and one either side (clock drift).
 * Returns the matching step so the caller can refuse it a second time, or null.
 * @param {string} secret
 * @param {string} code
 * @param {number} [now=Date.now()]
 * @returns {Promise<number | null>}
 */
export async function verifyTotp(secret, code, now = Date.now()) {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const step = Math.floor(now / 1000 / TOTP_STEP);
  for (const s of [step, step - 1, step + 1]) if ((await hotp(secret, s)) === digits) return s;
  return null;
}
/** otpauth:// link the QR code encodes. */
export const totpUri =
  /** @param {string} secret
   * @param {string} account
   * @returns {string}
   */ (secret, account) => `otpauth://totp/${encodeURIComponent(`${BRAND.shortName}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(BRAND.shortName)}&algorithm=SHA1&digits=6&period=${TOTP_STEP}`;
/**
 * Ten single-use recovery codes like "k7mq-2xpd", for when the phone is lost.
 * @returns {string[]}
 */
export function newRecoveryCodes() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => {
    const b = crypto.getRandomValues(new Uint8Array(8));
    const s = [...b].map((x) => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
export const normalizeRecoveryCode =
  /** @param {string} code
   * @returns {string}
   */ (code) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
// Secrets are encrypted at rest (AES-GCM) with a key that lives only in the Worker's MFA_KEY
// secret, so a copy of the database alone can't generate anyone's codes.
/**
 * @param {string} secret
 * @returns {Promise<CryptoKey>}
 */
async function aesKey(secret) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
/**
 * @param {string} plain
 * @param {string} keySecret
 * @returns {Promise<string>}
 */
export async function sealSecret(plain, keySecret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keySecret), enc.encode(plain));
  return `v1$${toHex(iv)}$${toHex(data)}`;
}
/**
 * @param {string} sealed
 * @param {string} keySecret
 * @returns {Promise<string>}
 */
export async function openSecret(sealed, keySecret) {
  const [v, iv, data] = sealed.split("$");
  if (v !== "v1") throw new Error("Unknown secret format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(iv) }, await aesKey(keySecret), fromHex(data));
  return new TextDecoder().decode(plain);
}
