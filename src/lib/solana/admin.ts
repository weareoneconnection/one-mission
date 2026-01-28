import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

export function loadAdminKeypair(): Keypair {
  // 方案1：BASE58 私钥（推荐）
  const b58 = process.env.WAOC_ADMIN_SECRET_BASE58;
  if (b58) return Keypair.fromSecretKey(bs58.decode(b58));

  // 方案2：JSON 数组字符串（例如 "[12,34,...]"）
  const json = process.env.WAOC_ADMIN_SECRET_JSON;
  if (json) {
    const arr = JSON.parse(json) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }

  throw new Error(
    "Missing admin keypair env: WAOC_ADMIN_SECRET_BASE58 or WAOC_ADMIN_SECRET_JSON"
  );
}
