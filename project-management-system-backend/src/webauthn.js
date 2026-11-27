// Passkeys and security keys (WebAuthn) as a second sign-in step, verified with Web Crypto.
// The browser hands over the public key in SPKI form (getPublicKey()), so no CBOR parsing is
// needed; attestation is "none": we trust the key the user registers while signed in.
const enc = new TextEncoder();
const dec = new TextDecoder();
export const ES256 = -7;
export const RS256 = -257;
/**
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {string}
 */
export function toB64url(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/**
 * @param {string} s
 * @returns {Uint8Array}
 */
export function fromB64url(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
/**
 * @returns {string}
 */
export function newChallenge() {
  return toB64url(crypto.getRandomValues(new Uint8Array(32)));
}
const sha256 =
  /** @param {Uint8Array} data
   * @returns {Promise<Uint8Array>}
   */ async (data) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));
const same =
  /** @param {Uint8Array} a
   * @param {Uint8Array} b
   * @returns {boolean}
   */ (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/**
 * The parts of the browser's clientDataJSON we check.
 * @param {string} b64
 * @returns {{ type: string; challenge: string; origin: string }}
 */
export function readClientData(b64) {
  try {
    const c = JSON.parse(dec.decode(fromB64url(b64)));
    return { type: String(c.type), challenge: String(c.challenge), origin: String(c.origin) };
  } catch {
    throw new Error("Unreadable passkey response");
  }
}
/**
 * Checks the authenticator data belongs to this site and the user was present; returns its counter.
 * @param {Uint8Array} authData
 * @param {string} rpId
 * @returns {Promise<number>}
 */
async function checkAuthData(authData, rpId) {
  if (authData.length < 37) throw new Error("Unreadable passkey response");
  if (!same(authData.slice(0, 32), await sha256(enc.encode(rpId)))) throw new Error("That passkey belongs to a different site");
  if (!(authData[32] & 0x01)) throw new Error("The passkey didn't confirm you were present");
  return new DataView(authData.buffer, authData.byteOffset).getUint32(33);
}
/**
 * @param {string} clientDataB64
 * @param {string} type
 * @param {string} challenge
 * @param {string} origin
 * @returns {void}
 */
function checkClient(clientDataB64, type, challenge, origin) {
  const c = readClientData(clientDataB64);
  if (c.type !== type) throw new Error("Unexpected passkey response");
  if (c.challenge !== challenge) throw new Error("That passkey request has expired. Try again.");
  if (c.origin !== origin) throw new Error("That passkey response came from a different site");
}
/**
 * @param {Uint8Array} spki
 * @param {number} alg
 * @returns {Promise<CryptoKey>}
 */
async function importKey(spki, alg) {
  if (alg === ES256) return crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  if (alg === RS256) return crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  throw new Error("This passkey uses a type of key Pulse doesn't support");
}
/**
 * WebAuthn ECDSA signatures are DER; Web Crypto wants the raw r‖s pair.
 * @param {Uint8Array} der
 * @returns {Uint8Array}
 */
function derToRaw(der) {
  if (der[0] !== 0x30) throw new Error("Bad signature");
  let i = 2;
  const part = () => {
    if (der[i] !== 0x02) throw new Error("Bad signature");
    const len = der[i + 1];
    let v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = part();
  const s = part();
  const raw = new Uint8Array(64);
  raw.set(r);
  raw.set(s, 32);
  return raw;
}
/**
 * Adding a passkey: checks the response matches our challenge and site, and that the key works.
 * @param {{
 *   clientDataJSON: string;
 *   authenticatorData: string;
 *   publicKey: string;
 *   alg: number;
 *   challenge: string;
 *   origin: string;
 *   rpId: string;
 * }} p
 * @returns {Promise<{ signCount: number }>}
 */
export async function verifyRegistration(p) {
  checkClient(p.clientDataJSON, "webauthn.create", p.challenge, p.origin);
  const signCount = await checkAuthData(fromB64url(p.authenticatorData), p.rpId);
  await importKey(fromB64url(p.publicKey), p.alg);
  return { signCount };
}
/**
 * Signing in with a passkey: verifies the signature over authenticatorData ‖ SHA-256(clientDataJSON).
 * @param {{
 *   clientDataJSON: string;
 *   authenticatorData: string;
 *   signature: string;
 *   publicKey: string;
 *   alg: number;
 *   storedCount: number;
 *   challenge: string;
 *   origin: string;
 *   rpId: string;
 * }} p
 * @returns {Promise<{ signCount: number }>}
 */
export async function verifyAssertion(p) {
  checkClient(p.clientDataJSON, "webauthn.get", p.challenge, p.origin);
  const authData = fromB64url(p.authenticatorData);
  const signCount = await checkAuthData(authData, p.rpId);
  const clientHash = await sha256(fromB64url(p.clientDataJSON));
  const signed = new Uint8Array(authData.length + clientHash.length);
  signed.set(authData);
  signed.set(clientHash, authData.length);
  const key = await importKey(fromB64url(p.publicKey), p.alg);
  const sig = fromB64url(p.signature);
  const ok = p.alg === ES256 ? await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(sig), signed) : await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, signed);
  if (!ok) throw new Error("That passkey didn't verify");
  // A counter that goes backwards suggests a cloned key. Many passkeys always report 0.
  if ((signCount || p.storedCount) && signCount <= p.storedCount) throw new Error("That passkey looks like a copy. Remove it and add it again.");
  return { signCount };
}
