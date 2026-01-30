import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function parseKeypair(json: string) {
  const arr = JSON.parse(json);
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

function loadPointsIdl() {
  // ✅ 从项目根目录读取：one-mission/idl/waoc_points.json
  // process.cwd() 在 Next.js node runtime 通常就是项目根目录
  const idlPath = path.join(process.cwd(), "idl", "waoc_points.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}. Put waoc_points.json in /idl`);
  }
  const raw = fs.readFileSync(idlPath, "utf8");
  return JSON.parse(raw);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { wallet, amount } = body as { wallet?: string; amount?: number };

    if (!wallet) throw new Error("Missing wallet");
    const amt = Number(amount || 0);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("Invalid amount");

    // ✅ 必须有 RPC
    const rpc = mustEnv("SOLANA_RPC_URL");
    const pointsProgramId = new PublicKey(mustEnv("NEXT_PUBLIC_WAOC_POINTS_PROGRAM_ID"));

    // ✅ admin keypair（JSON 数组格式）
    const admin = parseKeypair(mustEnv("WAOC_ADMIN_SECRET_KEY"));
    const userPk = new PublicKey(wallet);

    const connection = new Connection(rpc, "confirmed");

    // ✅ 运行时读取 IDL（不再有 ts import json 的路径/声明问题）
    const pointsIdl = loadPointsIdl();

    // ✅ Provider 用 admin 作为 signer
    const provider = new AnchorProvider(
      connection,
      {
        publicKey: admin.publicKey,
        signTransaction: async (tx: Transaction) => {
          tx.partialSign(admin);
          return tx;
        },
        signAllTransactions: async (txs: Transaction[]) => {
          txs.forEach((t) => t.partialSign(admin));
          return txs;
        },
      } as any,
      { commitment: "confirmed" }
    );

    const program = (await (Program as any).at(pointsProgramId, provider, pointsIdl as any)) as any;

    // points PDA：["points", user]
    const [pointsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("points"), userPk.toBuffer()],
      pointsProgramId
    );

    const latest = await connection.getLatestBlockhash("confirmed");

    // ⚠️ accounts 名称必须跟你 points IDL 一致
    // 这里先给最小集合。若报 missing account，把报错贴我，我按你的 IDL 精准补齐。
    const tx: Transaction = await program.methods
      .addPoints(new BN(Math.trunc(amt)))
      .accounts({
        admin: admin.publicKey,
        owner: userPk,  // 有的叫 user / owner / authority
        points: pointsPda,
      })
      .transaction();

    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = latest.blockhash;
    tx.sign(admin);

    const sig = await connection.sendRawTransaction(tx.serialize(), {
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
      throw new Error(`Confirmed with error: ${JSON.stringify(conf.value.err)}`);
    }

    return NextResponse.json({
      ok: true,
      tx: sig,
      wallet,
      amount: amt,
      pointsPda: pointsPda.toBase58(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 400 }
    );
  }
}
