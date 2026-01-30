// src/lib/solana/pointsReader.ts
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "./programs";
import { WAOC_POINTS_PROGRAM_ID, SEED_POINTS } from "./config";

// ✅ 直接静态引入 IDL（无 fs/path/process.cwd）
import waocPointsIdl from "../../../idl/waoc_points.json";

function bnToString(v: any): string {
  if (v == null) return "0";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(Math.trunc(v));
  if (typeof v === "bigint") return v.toString();
  if (typeof v?.toString === "function") return v.toString();
  return "0";
}

function toBase58Maybe(x: any): string {
  try {
    if (x && typeof x.toBase58 === "function") return x.toBase58();
  } catch {}
  return String(x ?? "");
}

/**
 * Read WAOC Points PDA and (if possible) decode it via IDL.
 * - Never assumes Program.at
 * - Works in API routes (nodejs runtime)
 */
export async function fetchPointsAccount(owner: string) {
  const connection = getConnection();

  const ownerStr = String(owner || "").trim();
  if (!ownerStr) throw new Error("missing owner");

  const programIdStr = String(WAOC_POINTS_PROGRAM_ID || "").trim();
  if (!programIdStr) throw new Error("missing WAOC_POINTS_PROGRAM_ID");

  const ownerPk = new PublicKey(ownerStr);
  const programIdPk = new PublicKey(programIdStr);

  // ✅ seeds must be Buffer
  const seedBuf = Buffer.from(String(SEED_POINTS || "points"));

  // ✅ PDA must use programId PublicKey
  const [pda] = PublicKey.findProgramAddressSync(
    [seedBuf, ownerPk.toBuffer()],
    programIdPk
  );

  const info = await connection.getAccountInfo(pda, "confirmed");
  if (!info) {
    return { exists: false as const, pda: pda.toBase58() };
  }

  // ✅ 用 coder 解码（不依赖 Program / 不触发 Wallet 导出问题）
  const coder = new BorshAccountsCoder(waocPointsIdl as any);

  // 账户名：尽量自动探测，避免你 IDL 里不是 PointsAccount 导致直接 throw
  const accountNameCandidates = [
    "PointsAccount",
    "pointsAccount",
    "points_account",
    "Points",
    "points",
  ];

  let acct: any = null;
  let usedName: string | null = null;
  let decodeError: string | null = null;

  for (const name of accountNameCandidates) {
    try {
      acct = coder.decode(name, info.data);
      usedName = name;
      decodeError = null;
      break;
    } catch (e: any) {
      decodeError = e?.message ? String(e.message) : String(e);
    }
  }

  // ✅ decode 失败也不要 500：返回 exists:true + 基础信息
  if (!acct) {
    return {
      exists: true as const,
      pda: pda.toBase58(),
      owner: ownerPk.toBase58(),
      total: "0",
      raw: {
        decode_error: decodeError,
        idl_account_tried: accountNameCandidates,
        owner: ownerPk.toBase58(),
      },
    };
  }

  // 尽量兼容各种字段命名
  const ownerAny = acct?.owner ?? acct?.authority ?? acct?.user ?? ownerPk;
  const totalAny =
    acct?.totalPoints ??
    acct?.total_points ??
    acct?.total ??
    acct?.pointsTotal ??
    acct?.points ??
    0;

  const bumpAny = acct?.bump ?? acct?._bump ?? null;
  const createdAny = acct?.createdAt ?? acct?.created_at ?? null;
  const updatedAny = acct?.updatedAt ?? acct?.updated_at ?? null;

  return {
    exists: true as const,
    pda: pda.toBase58(),
    owner: toBase58Maybe(ownerAny) || ownerPk.toBase58(),
    total: bnToString(totalAny),
    raw: {
      idl_account_name: usedName,
      owner: toBase58Maybe(ownerAny) || ownerPk.toBase58(),
      total_points: bnToString(totalAny),
      bump: bumpAny ?? null,
      created_at: createdAny != null ? bnToString(createdAny) : null,
      updated_at: updatedAny != null ? bnToString(updatedAny) : null,
    },
  };
}
