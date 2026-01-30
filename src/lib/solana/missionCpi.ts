// src/lib/solana/missionCpi.ts
import "server-only";

import fs from "fs";
import path from "path";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";

// ===== seeds (must match Rust) =====
const SEED_CONFIG = Buffer.from("points_config");
const SEED_POINTS = Buffer.from("points");

function mustEnv(name: string) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`missing_env:${name}`);
  return v;
}

function mustPkEnv(name: string) {
  return new PublicKey(mustEnv(name));
}

function readKeypairFromEnvPath(envName: string) {
  const v = mustEnv(envName);

  // ✅ 情况 A：Vercel / CI —— 直接给 JSON array
  if (v.trim().startsWith("[")) {
    const arr = JSON.parse(v);
    if (!Array.isArray(arr)) {
      throw new Error(`invalid_inline_keypair:${envName}`);
    }
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }

  // ✅ 情况 B：本地 —— 文件路径
  const abs = v.startsWith("~")
    ? path.join(process.env.HOME || "", v.slice(1))
    : v;

  const raw = fs.readFileSync(abs, "utf8");
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) {
    throw new Error(`invalid_keypair_json:${envName}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}


async function getAnchor() {
  // ✅ 用 dynamic import 绕开 turbopack 对 anchor named export 的静态检查
  const anchor = await import("@coral-xyz/anchor");
  return anchor;
}

/**
 * ✅ Admin-only onchain write (Phase-A / v1)
 * - 只调用 waoc_points.add_points
 * - authority = admin signer
 * - owner 不需要签名（points 合约里 owner 是 UncheckedAccount）
 *
 * 前提：
 * - 用户 points PDA 已经由用户自己 initialize_points 初始化过
 *   （因为你的合约 InitializePoints 要求 owner: Signer）
 */
export async function awardPointsOnchain(params: {
  owner: string;
  amount: number;
  meta?: {
    missionId?: string;
    periodKey?: string;
    submissionId?: string;
    ts?: number;
    admin?: string;
  };
}) {
  const ownerPk = new PublicKey(params.owner);
  const amount = Math.max(0, Math.trunc(params.amount || 0));
  if (!amount) return { ok: false as const, error: "invalid_amount" };

  const rpc = mustEnv("SOLANA_RPC_URL");
  const POINTS_PID = mustPkEnv("WAOC_POINTS_PROGRAM_ID");

  const adminKp = readKeypairFromEnvPath("WAOC_ADMIN_SECRET_JSON");

  const connection = new Connection(rpc, "confirmed");

  const anchor = await getAnchor();
  const { AnchorProvider, Program, BN } = anchor;

  // ✅ 构造一个最小 wallet（只需要 signTransaction）
  const wallet = {
    publicKey: adminKp.publicKey,
    async signTransaction(tx: any) {
      tx.partialSign(adminKp);
      return tx;
    },
    async signAllTransactions(txs: any[]) {
      txs.forEach((t) => t.partialSign(adminKp));
      return txs;
    },
  };

  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });

  // ✅ 直接从链上 fetch IDL（你已经确认 anchor idl fetch OK）
  const pointsProgram = (await Program.at(POINTS_PID, provider)) as any;

  const [configPda] = PublicKey.findProgramAddressSync([SEED_CONFIG], POINTS_PID);
  const [pointsPda] = PublicKey.findProgramAddressSync(
    [SEED_POINTS, ownerPk.toBuffer()],
    POINTS_PID
  );

  // ---- call add_points (admin signer) ----
  try {
    const tx = await pointsProgram.methods
      .addPoints(new BN(amount))
      .accounts({
        config: configPda,
        points: pointsPda,
        owner: ownerPk,               // ✅ 不需要签名
        authority: adminKp.publicKey, // ✅ 唯一 signer
      })
      .rpc();

    return { ok: true as const, tx, configPda: configPda.toBase58(), pointsPda: pointsPda.toBase58() };
  } catch (e: any) {
    const msg = String(e?.message || e);

    // 常见：points 账号没 init（用户没点过初始化）
    if (msg.toLowerCase().includes("accountnotfound") || msg.toLowerCase().includes("could not find account")) {
      return {
        ok: false as const,
        error: "points_not_initialized_for_owner",
        hint: "Owner must run initialize_points once (from frontend) before admin can add_points.",
        details: msg,
        pointsPda: pointsPda.toBase58(),
      };
    }

    return { ok: false as const, error: msg, pointsPda: pointsPda.toBase58() };
  }
}
