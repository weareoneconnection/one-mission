import bs58 from "bs58";
import nacl from "tweetnacl";
import fs from "fs";

function randNonce() {
  return bs58.encode(nacl.randomBytes(12));
}
function loadKeypair(path) {
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  const secret = Uint8Array.from(raw);
  if (secret.length !== 64) throw new Error(`Bad keypair length=${secret.length} (need 64)`);
  return secret;
}

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/admin-request.mjs "<url>" [method] [jsonBody] [keypairPath]');
  process.exit(1);
}
const method = (process.argv[3] || "GET").toUpperCase();
const bodyRaw = process.argv[4] || "";
const keypairPath = process.argv[5] || `${process.env.HOME}/.config/solana/id.json`;

const secretKey = loadKeypair(keypairPath);
const publicKey = secretKey.slice(32);
const wallet58 = bs58.encode(publicKey);

const ts = Date.now();
const nonce = randNonce();
const msg = `WAOC_ONE_MISSION_ADMIN|wallet=${wallet58}|nonce=${nonce}|ts=${ts}`;
const sig = nacl.sign.detached(new TextEncoder().encode(msg), secretKey);
const sig58 = bs58.encode(sig);

const headers = {
  "x-admin-wallet": wallet58,
  "x-admin-msg": msg,
  "x-admin-sig": sig58,
};

const init = { method, headers };
if (method !== "GET") {
  init.headers["content-type"] = "application/json";
  init.body = bodyRaw || "{}";
}

const res = await fetch(url, init);
const text = await res.text();
process.stdout.write(text);
