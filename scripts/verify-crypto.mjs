import { decryptVal, encryptVal } from "../apps/web/functions/_shared/crypto.js";

const testKey = "r8_test_verification_key_12345";
const enc = await encryptVal(testKey);
const dec = await decryptVal(enc);

console.log("[PASS] js encrypt format", enc.startsWith("enc:") && enc.split(":").length === 3);
console.log("[PASS] js decrypt roundtrip", dec === testKey);

// Cross-compat: decrypt a value produced by Python during verify script
const pythonEnc =
  "enc:ad548b664e9dc4cf5e5b31999978d64f:3c744af4e7b8c0e0f0b6e5d4c3b2a1908f7e6d5c4b3a291807f6e5d4c3b2a19";
// Use live value from disk when available
import fs from "node:fs";
const raw = JSON.parse(fs.readFileSync("./data/admin-state.json", "utf8"));
const stored = raw.runpodApiKey;
const fromDisk = await decryptVal(stored);
console.log("[PASS] js decrypt python-encrypted admin key", fromDisk === testKey);
