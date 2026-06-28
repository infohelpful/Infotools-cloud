const SECRET_PBKDF2_KEY = new TextEncoder().encode(
  "cloudflare-r2-secure-key-generation-phrase-1029",
);

const SENSITIVE_FIELDS = [
  "r2AccountId",
  "r2S3Endpoint",
  "r2AccessKeyId",
  "r2SecretAccessKey",
  "runpodApiKey",
];

/** @param {number} length @param {Uint8Array} salt */
async function deriveKeystream(length, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    SECRET_PBKDF2_KEY,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 1000, hash: "SHA-256" },
    keyMaterial,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** @param {string} val */
export async function encryptVal(val) {
  if (!val) return "";
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const plaintext = new TextEncoder().encode(val);
  const keystream = await deriveKeystream(plaintext.length, salt);
  const ciphertext = plaintext.map((byte, i) => byte ^ keystream[i]);
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
  const cipherHex = [...ciphertext].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `enc:${saltHex}:${cipherHex}`;
}

/** @param {string} val */
export async function decryptVal(val) {
  if (!val || !val.startsWith("enc:")) return val;
  try {
    const parts = val.split(":");
    if (parts.length !== 3) return "";
    const salt = new Uint8Array(parts[1].match(/.{1,2}/g).map((h) => parseInt(h, 16)));
    const ciphertext = new Uint8Array(parts[2].match(/.{1,2}/g).map((h) => parseInt(h, 16)));
    const keystream = await deriveKeystream(ciphertext.length, salt);
    const plaintext = ciphertext.map((byte, i) => byte ^ keystream[i]);
    return new TextDecoder().decode(plaintext);
  } catch {
    return "";
  }
}

/** @param {Record<string, unknown>} state */
export async function decryptAdminSecrets(state) {
  const next = { ...state };
  for (const field of SENSITIVE_FIELDS) {
    if (typeof next[field] === "string") {
      next[field] = await decryptVal(next[field]);
    } else if (next[field] === undefined) {
      next[field] = "";
    }
  }
  return next;
}

/** @param {Record<string, unknown>} state */
export async function encryptAdminSecrets(state) {
  const next = { ...state };
  for (const field of SENSITIVE_FIELDS) {
    next[field] = await encryptVal(String(next[field] || ""));
  }
  return next;
}
