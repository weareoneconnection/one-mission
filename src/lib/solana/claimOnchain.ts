// src/lib/solana/claimOnchain.ts
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Connection,
  Transaction,
  SystemProgram,
  SendTransactionError,
} from "@solana/web3.js";

// ✅ Points IDL（请确保这个文件存在：idl/waoc_points.json）
import pointsIdl from "../../../idl/waoc_points.json";

// -------------------- seeds（按你既有 points 程序习惯） --------------------
const SEED_POINTS_CONFIG = Buffer.from("points_config");
const SEED_POINTS = Buffer.from("points");

// -------------------- 常见 program/sysvar ids（不依赖 spl-token 包） --------------------
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSVAR_RENT_PUBKEY = new PublicKey("SysvarRent111111111111111111111111111111111");
const SYSVAR_CLOCK_PUBKEY = new PublicKey("SysvarC1ock11111111111111111111111111111111");
const SYSVAR_INSTRUCTIONS_PUBKEY = new PublicKey("Sysvar1nstructions1111111111111111111111111");

// -------------------- 类型 --------------------
export type ClaimOnchainParams = {
  wallet: any;
  connection: Connection;
  amount: number;
  missionId?: string;
  periodKey?: string;

  // ✅ 强一致：由页面传入 points program / pda
  pointsProgramId: string;
  pointsPda: string;
};

type Ok = { ok: true; tx: string };
type Err = { ok: false; error: string; logs?: string[] };

function rpcEndpoint(conn: Connection) {
  return (conn as any)?.rpcEndpoint || "unknown";
}

// 从 IDL 里挑一个最像“用户 claim/sync” 的指令名
function pickClaimInstructionName(idl: any): string {
  const ins: Array<{ name: string }> = Array.isArray(idl?.instructions) ? idl.instructions : [];
  const names = ins.map((i) => i.name);

  const priority = [
    "claimPoints",
    "claim_points",
    "claim",
    "redeemPoints",
    "redeem_points",
    "redeem",
    "syncPoints",
    "sync_points",
    "sync",
    "withdrawPoints",
    "withdraw_points",
    "withdraw",
    "applyPoints",
    "apply_points",
  ];

  const lower = (s: string) => String(s || "").toLowerCase();

  for (const p of priority) {
    const hit = names.find((n) => lower(n) === lower(p));
    if (hit) return hit;
  }

  // fallback：含 claim/sync/redeem 的第一个
  const fuzzy =
    names.find((n) => /claim/i.test(n)) ||
    names.find((n) => /sync/i.test(n)) ||
    names.find((n) => /redeem/i.test(n)) ||
    names.find((n) => /withdraw/i.test(n));

  if (fuzzy) return fuzzy;

  // 再 fallback：用第一个指令（不推荐，但至少能给出更明确的“缺什么账户/参数”）
  if (names[0]) return names[0];

  throw new Error("Points IDL has no instructions");
}

// 用 IDL args 自动拼参数（amount / missionId / periodKey）
function buildArgs(idlIx: any, amount: number, missionId?: string, periodKey?: string) {
  const args = Array.isArray(idlIx?.args) ? idlIx.args : [];
  if (args.length === 0) return [];

  const amountBn = new BN(Math.trunc(amount));
  const out: any[] = [];

  for (const a of args) {
    const name = String(a?.name || "");
    const t = a?.type;

    const lname = name.toLowerCase();

    // 常见：amount/u64
    if (lname.includes("amount") || lname.includes("points") || lname.includes("delta")) {
      out.push(amountBn);
      continue;
    }

    // 常见：missionId/string
    if (lname.includes("mission")) {
      out.push(String(missionId || ""));
      continue;
    }

    // 常见：periodKey/string
    if (lname.includes("period")) {
      out.push(String(periodKey || ""));
      continue;
    }

    // 兜底：按类型塞默认值
    if (t === "string" || t?.defined === "String") {
      out.push("");
      continue;
    }

    // u64/i64/u128 等：给 amountBn
    if (typeof t === "string" && /u\d+|i\d+/.test(t)) {
      out.push(amountBn);
      continue;
    }

    if (t === "bool") {
      out.push(false);
      continue;
    }

    // 其它类型（比如 struct/vec），无法安全猜
    throw new Error(
      `Cannot auto-fill arg "${name}" of type ${JSON.stringify(t)}. Please adjust buildArgs().`
    );
  }

  return out;
}

// 用 IDL accounts 自动拼 accounts（points/pointsConfig/user/systemProgram等）
function buildAccounts(params: {
  idlIx: any;
  ownerPk: PublicKey;
  pointsPdaPk: PublicKey;
  pointsConfigPda: PublicKey;
}) {
  const { idlIx, ownerPk, pointsPdaPk, pointsConfigPda } = params;

  const accs: Array<{ name: string; isSigner?: boolean; isMut?: boolean }> = Array.isArray(idlIx?.accounts)
    ? idlIx.accounts
    : [];

  const out: Record<string, PublicKey> = {};
  const missing: string[] = [];

  for (const a of accs) {
    const name = String(a?.name || "");
    const lname = name.toLowerCase();

    // owner/user/authority/signer
    if (["owner", "user", "authority", "signer"].includes(lname) || lname.endsWith("authority")) {
      out[name] = ownerPk;
      continue;
    }

    // points account
    if (lname === "points" || lname === "pointsaccount" || lname === "points_account") {
      out[name] = pointsPdaPk;
      continue;
    }

    // points config
    if (
      lname === "pointsconfig" ||
      lname === "points_config" ||
      lname === "config" ||
      lname.endsWith("config")
    ) {
      out[name] = pointsConfigPda;
      continue;
    }

    // system program
    if (lname === "systemprogram" || lname === "system_program") {
      out[name] = SystemProgram.programId;
      continue;
    }

    // rent/clock/instructions sysvars
    if (lname === "rent") {
      out[name] = SYSVAR_RENT_PUBKEY;
      continue;
    }
    if (lname === "clock") {
      out[name] = SYSVAR_CLOCK_PUBKEY;
      continue;
    }
    if (lname === "instructions" || lname === "instructionssysvar") {
      out[name] = SYSVAR_INSTRUCTIONS_PUBKEY;
      continue;
    }

    // token programs (如果你的 points 程序涉及 SPL)
    if (lname === "tokenprogram" || lname === "token_program") {
      out[name] = TOKEN_PROGRAM_ID;
      continue;
    }
    if (lname === "associatedtokenprogram" || lname === "associated_token_program") {
      out[name] = ASSOCIATED_TOKEN_PROGRAM_ID;
      continue;
    }

    // 其它未知账户：先记下来
    missing.push(name);
  }

  if (missing.length > 0) {
    throw new Error(
      `Cannot auto-resolve required accounts: ${missing.join(
        ", "
      )}. Please map them in buildAccounts() based on your points IDL.`
    );
  }

  return out;
}

export async function claimOnchain({
  wallet,
  connection,
  amount,
  missionId,
  periodKey,
  pointsProgramId,
  pointsPda,
}: ClaimOnchainParams): Promise<Ok | Err> {
  try {
    if (!wallet?.publicKey) throw new Error("Wallet not connected");
    if (!wallet.signTransaction) throw new Error("Wallet cannot sign");
    if (!amount || amount <= 0) throw new Error("Invalid amount");
    if (!pointsProgramId) throw new Error("Missing pointsProgramId");
    if (!pointsPda) throw new Error("Missing pointsPda");

    const POINTS_PID = new PublicKey(pointsProgramId);
    const ownerPk = wallet.publicKey as PublicKey;
    const pointsPdaPk = new PublicKey(pointsPda);

    // ✅ 诊断：points program 必须存在
    const pointsAcc = await connection.getAccountInfo(POINTS_PID);
    if (!pointsAcc) {
      throw new Error(
        `ProgramAccountNotFound: points program not found. programId=${POINTS_PID.toBase58()} rpc=${rpcEndpoint(
          connection
        )}`
      );
    }

    // ✅ Anchor provider
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });

    // ✅ Program.at（兼容你当前 anchor 版本）
    const program = (await (Program as any).at(
      POINTS_PID,
      provider,
      pointsIdl as any
    )) as any;

    // 选指令
    const ixName = pickClaimInstructionName(pointsIdl as any);

    // 找到该指令的 idl 描述（用于 accounts/args）
    const idlIx =
      (pointsIdl as any)?.instructions?.find((i: any) => i?.name === ixName) ||
      (pointsIdl as any)?.instructions?.find((i: any) => String(i?.name || "").toLowerCase() === String(ixName).toLowerCase());

    if (!idlIx) {
      const all = ((pointsIdl as any)?.instructions || []).map((i: any) => i?.name).filter(Boolean);
      throw new Error(`Cannot find instruction "${ixName}" in points IDL. Available: ${all.join(", ")}`);
    }

    // pointsConfig PDA（通用 seed）
    const [pointsConfigPda] = PublicKey.findProgramAddressSync(
      [SEED_POINTS_CONFIG],
      POINTS_PID
    );

    // 如果你的 points 程序 pointsPda 也是标准 seed，可以做一致性校验（可选）
    // const [expectedPointsPda] = PublicKey.findProgramAddressSync([SEED_POINTS, ownerPk.toBuffer()], POINTS_PID);

    // 自动拼 args / accounts
    const args = buildArgs(idlIx, amount, missionId, periodKey);
    const accounts = buildAccounts({
      idlIx,
      ownerPk,
      pointsPdaPk,
      pointsConfigPda,
    });

    // ===== 手动 Transaction 模式 =====
    const latest = await connection.getLatestBlockhash("confirmed");

    // program.methods[ixName](...args).accounts(accounts).transaction()
    const builder = (program.methods as any)[ixName];
    if (typeof builder !== "function") {
      const avail = Object.keys(program.methods || {});
      throw new Error(
        `Program.methods["${ixName}"] not found. Available methods: ${avail.join(", ")}`
      );
    }

    const tx: Transaction = await builder(...args).accounts(accounts).transaction();

    tx.feePayer = ownerPk;
    tx.recentBlockhash = latest.blockhash;

    const signed = await wallet.signTransaction(tx);

    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });

    const conf = await connection.confirmTransaction(
      {
        signature: sig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );

    if (conf.value.err) {
      throw new Error(`Transaction confirmed with error: ${JSON.stringify(conf.value.err)}`);
    }

    return { ok: true, tx: sig };
  } catch (e: any) {
    const msg = String(e?.message || e);
    let logs: string[] | undefined;

    try {
      if (e instanceof SendTransactionError && typeof (e as any).getLogs === "function") {
        logs = await (e as any).getLogs(connection);
      } else if (typeof e?.getLogs === "function") {
        logs = await e.getLogs(connection);
      }
    } catch {
      // ignore
    }

    return { ok: false, error: msg, logs };
  }
}
