export const SESSION_COOKIE_NAME = "cheetah_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  userId: number;
  username: string;
  isAdmin: boolean;
  exp: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signSessionToken(
  payload: Omit<SessionPayload, "exp">,
  secret: string,
  ttlSeconds = SESSION_TTL_SECONDS
): Promise<string> {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoder = new TextEncoder();
  const data = toBase64Url(encoder.encode(JSON.stringify(fullPayload)));
  const key = await importHmacKey(secret);
  const sigBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const sig = toBase64Url(new Uint8Array(sigBuffer));
  return `${data}.${sig}`;
}

export async function verifySessionToken(
  token: string,
  secret: string
): Promise<SessionPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [data, sig] = parts;
    if (!data || !sig) return null;

    const encoder = new TextEncoder();
    const key = await importHmacKey(secret);
    const sigBytes = fromBase64Url(sig);
    const sigArrayBuffer = sigBytes.buffer.slice(
      sigBytes.byteOffset,
      sigBytes.byteOffset + sigBytes.byteLength
    ) as ArrayBuffer;
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigArrayBuffer,
      encoder.encode(data)
    );
    if (!valid) return null;

    const json = new TextDecoder().decode(fromBase64Url(data));
    const parsed = JSON.parse(json) as SessionPayload;
    if (
      typeof parsed.userId !== "number" ||
      typeof parsed.username !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
