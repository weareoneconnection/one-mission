// src/lib/solana/pointsReader.ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { getProvider } from "./anchor";

const SEED_POINTS = Buffer.from("points");
const IDL_POINTS_PATH = path.join(process.cwd(), "idl", "waoc_points.json");

function loadPointsIdl(): any {
  return JSON.parse(fs.readFileSync(IDL_POINTS_PATH, "utf8"));
}

function bnToString(v: any): string {
  if (v == null) return "0";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(Math.trunc(v));
  if (typeof v === "bigint") return v.toString();
  if (typeof v?.toString === "function") return v.toString();
  return "0";
}

export async function fetchPointsAccount(owner: string) {
  const provider = getProvider();

  const ownerPk = new PublicKey(owner);
  const pointsProgramId = new PublicKey(process.env.WAOC_POINTS_PROGRAM_ID!);

  const [pda] = PublicKey.findProgramAddressSync(
    [SEED_POINTS, ownerPk.toBuffer()],
    pointsProgramId
  );

  const info = await provider.connection.getAccountInfo(pda, "confirmed");
  if (!info) {
    return { exists: false as const, pda: pda.toBase58() };
  }

  // ✅ 不用 Program，直接用 coder 解码（规避 idl.accounts[].size）
  const idl = loadPointsIdl();
  const coder = new anchor.BorshAccountsCoder(idl);

  // 账户名必须和 IDL 的 accounts.name 对上（你的是 PointsAccount）
  const acct: any = coder.decode("PointsAccount", info.data);

  const ownerAny = acct?.owner ?? acct?.authority ?? acct?.user ?? ownerPk;
  const totalAny =
    acct?.totalPoints ??
    acct?.total_points ??
    acct?.total ??
    acct?.pointsTotal ??
    0;

  const bumpAny = acct?.bump ?? acct?._bump ?? null;
  const createdAny = acct?.createdAt ?? acct?.created_at ?? null;
  const updatedAny = acct?.updatedAt ?? acct?.updated_at ?? null;

  return {
    exists: true as const,
    pda: pda.toBase58(),
    owner: typeof ownerAny?.toBase58 === "function" ? ownerAny.toBase58() : String(ownerAny),
    total: bnToString(totalAny),
    raw: {
      owner: typeof ownerAny?.toBase58 === "function" ? ownerAny.toBase58() : String(ownerAny),
      total_points: bnToString(totalAny),
      bump: bumpAny ?? null,
      created_at: createdAny ? bnToString(createdAny) : null,
      updated_at: updatedAny ? bnToString(updatedAny) : null,
    },
  };
}
