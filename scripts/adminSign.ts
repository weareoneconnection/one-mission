import fs from "fs";
import path from "path";
import bs58 from "bs58";
import nacl from "tweetnacl";

function loadKeypair() {
  const kpPath =
    process.env.SOLANA_KEYPAIR ||
    path.join(process.env.HOME || "", ".config", "solana", "id.json");

  const secret = JSON.parse(fs.readFileSync(kpPath, "utf8"));
  const secretKey = Uint8Array.from(secret); // 64 bytes
  return secretKey;
}

// ✅ 建议：把接口路径写进 msg，避免签名被拿去调用别的接口
function buildAdminMsg() {
  // 你也可以扩展：加 body hash / cluster 等
  return "POST:/api/mission/approve";
}

async function main() {
  const secretKey = loadKeypair();
  const timestamp = Date.now().toString();
  const msg = buildAdminMsg();

  // ✅ 统一签名 payload：msg|timestamp
  const payload = `${msg}|${timestamp}`;
  const sig = nacl.sign.detached(Buffer.from(payload, "utf8"), secretKey);

  // wallet = secretKey 对应公钥 base58
  // secretKey 前 32 bytes 是私钥种子；tweetnacl 的 keypair 可由 secretKey 推出公钥
  const kp = nacl.sign.keyPair.fromSecretKey(secretKey);
  const wallet = bs58.encode(kp.publicKey);

  console.log("\n--- COPY BELOW ---\n");
  console.log(`x-admin-wallet: ${wallet}`);
  console.log(`x-admin-timestamp: ${timestamp}`);
  console.log(`x-admin-msg: ${msg}`);
  console.log(`x-admin-signature: ${bs58.encode(sig)}`);
  console.log("\n------------------\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

