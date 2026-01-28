// src/lib/solana/missionCpi.ts
import * as anchor from "@coral-xyz/anchor/dist/cjs";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { getProvider, getWaocMissionProgram, getWaocPointsProgram } from "./anchor";

const SEED_MISSION_SIGNER = Buffer.from("mission_signer");
const SEED_POINTS_CONFIG = Buffer.from("points_config");
const SEED_POINTS = Buffer.from("points");

// Solana Memo Program (fixed id)
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// --- helpers ---
function toCamel(s: string) {
  // award_points -> awardPoints
  return s.replace(/_([a-z0-9])/g, (_, c) => String(c).toUpperCase());
}

function pickMethod(program: any, idlName: string) {
  const camel = toCamel(idlName);
  const m1 = program?.methods?.[camel];
  if (typeof m1 === "function") return { fnName: camel, fn: m1 };

  const m2 = program?.methods?.[idlName];
  if (typeof m2 === "function") return { fnName: idlName, fn: m2 };

  // 兜底：把可用指令列出来，避免 encode 这种“黑盒报错”
  const names = (program?.idl?.instructions || [])
    .map((i: any) => i?.name)
    .filter(Boolean);
  throw new Error(
    `anchor_method_not_found: want=${idlName} (try ${camel}/${idlName}) idl_instructions=${JSON.stringify(names)}`
  );
}

function safeMemoString(v: any, maxBytes = 450) {
  // 尽量短：用紧凑 JSON
  let s = "";
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v ?? "");
  }

  const enc = new TextEncoder();
  const bytes = enc.encode(s);
  if (bytes.length <= maxBytes) return s;

  // 超长就截断（保持可解析性：加一个 ...）
  // 这里用“按字符”截断做近似，避免复杂的按字节截断
  const cut = Math.max(0, Math.floor((s.length * maxBytes) / bytes.length) - 3);
  return s.slice(0, cut) + "...";
}

function buildMemoIx(memo: string) {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [],
    data: Buffer.from(memo, "utf8"),
  });
}

export type AwardMeta = {
  missionId?: string;
  periodKey?: string;
  admin?: string;
  ts?: number;
  // 你未来想带 submissionId / proofHash 也可以加：
  submissionId?: string;
};

/**
 * ✅ 上链加分（失败不 throw，返回 ok:false）
 * - fast path: award_points
 * - 若 mission_signer 未 init -> init_mission_signer -> retry
 *
 * ✅ 可选 meta：会写入 Memo（Phase B: Proof of Mission 的最小可用版本）
 *
 * ⚠️ 注意：你现在 waoc_points 并没有 init_points 指令（你 IDL 只有 2 个 instruction 都在 waoc_mission）
 * 所以这里不做 initPoints。points account 是否自动创建，应由 mission program CPI 里处理。
 */
export async function awardPointsOnchain(params: { owner: string; amount: number; meta?: AwardMeta }) {
  const provider = getProvider();
  const missionProgram: any = getWaocMissionProgram(provider);
  const pointsProgram: any = getWaocPointsProgram(provider);

  const ownerPk = new PublicKey(params.owner);
  const amountBn = new anchor.BN(Math.max(0, Math.trunc(params.amount)));

  const [missionSignerPda] = PublicKey.findProgramAddressSync(
    [SEED_MISSION_SIGNER],
    missionProgram.programId
  );

  const [configPda] = PublicKey.findProgramAddressSync(
    [SEED_POINTS_CONFIG],
    pointsProgram.programId
  );

  const [pointsPda] = PublicKey.findProgramAddressSync(
    [SEED_POINTS, ownerPk.toBuffer()],
    pointsProgram.programId
  );

  const callAward = async () => {
    // ✅ 用 IDL 名称，避免版本差异导致 encode undefined
    const { fnName, fn } = pickMethod(missionProgram, "award_points");

    // ✅ Phase B：可选 memo（proof of mission 基础）
    // 尽量短，避免交易过大
    const memoObj =
      params.meta && Object.keys(params.meta).length
        ? {
            p: "waoc", // prefix
            v: 1,
            owner: params.owner,
            amt: Math.max(0, Math.trunc(params.amount)),
            mid: params.meta.missionId || undefined,
            pk: params.meta.periodKey || undefined,
            admin: params.meta.admin || undefined,
            ts: params.meta.ts || undefined,
            sid: params.meta.submissionId || undefined,
          }
        : null;

    const memoIx = memoObj ? buildMemoIx(safeMemoString(memoObj)) : null;

    let builder = fn(amountBn).accounts({
      waocPointsProgram: pointsProgram.programId,
      pointsConfig: configPda,
      points: pointsPda,
      owner: ownerPk,
      missionSigner: missionSignerPda,
      admin: provider.wallet.publicKey,
    });

    if (memoIx) {
      // Anchor method builder 支持 preInstructions
      builder = builder.preInstructions([memoIx]);
    }

    const tx = await builder.rpc();

    return { tx, fnName, memo: memoObj ? safeMemoString(memoObj) : null };
  };

  try {
    const r = await callAward();
    return { ok: true as const, tx: r.tx, usedMethod: r.fnName, memo: r.memo };
  } catch (e: any) {
    const msg = String(e?.message || e);

    const needInitMissionSigner =
      msg.includes("AccountNotInitialized") ||
      msg.includes("mission_signer") ||
      msg.includes("3012");

    if (!needInitMissionSigner) {
      return { ok: false as const, error: msg };
    }

    try {
      const { fnName, fn } = pickMethod(missionProgram, "init_mission_signer");

      await fn()
        .accounts({
          missionSigner: missionSignerPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const r2 = await callAward();
      return {
        ok: true as const,
        tx: r2.tx,
        usedMethod: r2.fnName,
        memo: r2.memo,
        didInitMissionSigner: true as const,
        usedInitMethod: fnName,
      };
    } catch (e2: any) {
      return { ok: false as const, error: String(e2?.message || e2) };
    }
  }
}
