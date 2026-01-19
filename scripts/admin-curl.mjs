import bs58 from "bs58";
import nacl from "tweetnacl";
import fs from "fs";

function randNonce() {
  // 12 bytes -> base58 nonce
  return bs58.encode(nacl.randomBytes(12));
}

function loadKeypair(path) {
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  const secret = Uint8Array.from(raw);
  if (secret.length !== 64) {
    throw new Error(`Bad keypair length=${secret.length}, expected 64. Path=${path}`);
  }
  return secret;
}

const url = process.argv[2] || "http://127.0.0.1:3000/api/mission/pending?limit=5";
const keypairPath = process.argv[3] || `${process.env.HOME}/.config/solana/id.json`;

const secretKey = loadKeypair(keypairPath);
const publicKey = secretKey.slice(32);
const wallet58 = bs58.encode(publicKey);

const ts = Date.now();
const nonce = randNonce();

const msg = `WAOC_ONE_MISSION_ADMIN|wallet=${wallet58}|nonce=${nonce}|ts=${ts}`;
const data = new TextEncoder().encode(msg);
const sig = nacl.sign.detached(data, secretKey);
const sig58 = bs58.encode(sig);

const curl = [
  "curl",
  `"${url}"`,
  `-H "x-admin-wallet: ${wallet58}"`,
  `-H "x-admin-msg: ${msg}"`,
  `-H "x-admin-sig: ${sig58}"`,
].join(" \\\n  ");

console.log(curl);
