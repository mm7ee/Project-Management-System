// Password hashing (PBKDF2-SHA256) and session tokens. Stored hashes look like
// "pbkdf2$<iterations>$<salt hex>$<hash hex>"; seeds in migrations/ use the same format.

const ITERATIONS = 100_000; // the Workers runtime caps PBKDF2 at 100k
const enc = new TextEncoder();

const toHex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return toHex(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${await derive(password, salt, ITERATIONS)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
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
export function tempPassword(): string {
  // Bytes at or above the largest multiple of the alphabet size are skipped, so every
  // character is equally likely.
  const limit = 256 - (256 % TEMP_ALPHABET.length);
  let chars = "";
  while (chars.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && chars.length < 12) chars += TEMP_ALPHABET.charAt(b % TEMP_ALPHABET.length);
    }
  }
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export const newToken = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

/** Sessions are stored by the SHA-256 of their token, so a leaked database can't be replayed. */
export async function tokenHash(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(token)));
}
