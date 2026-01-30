// src/lib/solana/anchor.ts
import "server-only";

import { Connection, Keypair } from "@solana/web3.js";
import fs from "node:fs";

function mustEnv(name: string) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`missing_env:${name}`);
  return v;
}

function getRpcUrl() {
  return (
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com"
  );
}

/**
 * ✅ 支持 3 种写法：
 * 1) WAOC_ADMIN_SECRET_JSON='[1,2,3,...]'                 (数组 JSON)
 * 2) WAOC_ADMIN_SECRET_JSON='{"secretKey":[...]}'
 * 3) WAOC_ADMIN_SECRET_JSON='/abs/path/to/id.json'        (文件路径)
 */
function loadKeypairFromEnv(envName: string): Keypair {
  const raw = mustEnv(envName);

  // a) looks like json array
  const s = raw.trim();
  if (s.startsWith("[")) {
    const arr = JSON.parse(s);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }

  // b) json object
  if (s.startsWith("{")) {
    const obj = JSON.parse(s);
    const arr = obj?.secretKey || obj?.secret_key || obj?.secret;
    if (!arr) throw new Error(`invalid_${envName}:missing_secretKey`);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }

  // c) treat as path
  if (!fs.existsSync(s)) {
    throw new Error(`ENOENT: no such file or directory, open '${s}'`);
  }
  const file = JSON.parse(fs.readFileSync(s, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(file));
}

export async function getLocalProvider() {
  // ✅ 动态 import，避免 Next/Turbopack 在非 node 环境解析 Anchor 导致奇怪报错
  const anchor = await import("@coral-xyz/anchor");

  const connection = new Connection(getRpcUrl(), "confirmed");
  const kp = loadKeypairFromEnv("WAOC_ADMIN_SECRET_JSON");
  const wallet = new anchor.Wallet(kp);

  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  return { anchor, provider };
}
