// Browser side of passkeys and security keys (WebAuthn): turns the server's options into a
// navigator.credentials call and the result into plain base64url strings for the API.

const toB64url = (buf: ArrayBuffer) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Passkeys need a secure page and a browser that supports them (all current ones do). */
export const passkeysSupported = () => typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

/** Friendlier words for the browser's errors, chiefly "you cancelled". */
function explain(e: unknown): Error {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return new Error("Cancelled, or the device didn't respond. Try again.");
  if (name === "InvalidStateError") return new Error("That passkey is already on your account.");
  if (name === "SecurityError") return new Error("Passkeys only work on the Pulse website address.");
  return e instanceof Error ? e : new Error("The passkey didn't work");
}

export interface RegisterOptions {
  challenge: string;
  rpId: string;
  user: { id: string; name: string; displayName: string };
  exclude: string[];
}

/** Creates a passkey on this device (or a security key) and returns what the server stores. */
export async function createPasskey(o: RegisterOptions) {
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge: fromB64url(o.challenge),
        rp: { id: o.rpId, name: "Pulse" },
        user: { id: new TextEncoder().encode(o.user.id), name: o.user.name, displayName: o.user.displayName },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
        excludeCredentials: o.exclude.map((id) => ({ type: "public-key", id: fromB64url(id) })),
        attestation: "none",
        timeout: 120_000,
      },
    })) as PublicKeyCredential;
  } catch (e) {
    throw explain(e);
  }
  const r = cred.response as AuthenticatorAttestationResponse;
  const publicKey = r.getPublicKey?.();
  if (!publicKey) throw new Error("This browser can't add passkeys here. Try a current Edge, Chrome, Safari or Firefox.");
  return {
    id: cred.id,
    clientDataJSON: toB64url(r.clientDataJSON),
    authenticatorData: toB64url(r.getAuthenticatorData()),
    publicKey: toB64url(publicKey),
    alg: r.getPublicKeyAlgorithm(),
  };
}

/** Signs the server's sign-in challenge with one of the account's passkeys. */
export async function signWithPasskey(o: { challenge: string; rpId: string; allow: string[] }) {
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: fromB64url(o.challenge),
        rpId: o.rpId,
        allowCredentials: o.allow.map((id) => ({ type: "public-key", id: fromB64url(id) })),
        userVerification: "preferred",
        timeout: 120_000,
      },
    })) as PublicKeyCredential;
  } catch (e) {
    throw explain(e);
  }
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    clientDataJSON: toB64url(r.clientDataJSON),
    authenticatorData: toB64url(r.authenticatorData),
    signature: toB64url(r.signature),
  };
}
