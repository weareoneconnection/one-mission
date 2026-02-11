import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function s(v: any, max = 2000) {
  return String(v ?? "").slice(0, max);
}

function noStoreJson(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

// env（推荐）
// WAOC_MINT=82gi7mybA1yHi56FcCC9wvTPzew5hsxP2wdHv4nYpump
// MIN_WAOC_HOLD=50000
// SOLANA_RPC=https://api.mainnet-beta.solana.com
function getWaocMint(): PublicKey {
  const mint = s(process.env.WAOC_MINT || "82gi7mybA1yHi56FcCC9wvTPzew5hsxP2wdHv4nYpump", 128).trim();
  return new PublicKey(mint);
}
function getMinHold() {
  const v = Number(process.env.MIN_WAOC_HOLD ?? 50000);
  return Number.isFinite(v) ? Math.max(0, v) : 50000;
}
function getRpc() {
  return s(process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com", 2000).trim();
}

// ✅ 复用 Connection（减少 RPC 压力）
function getConn() {
  const g = globalThis as unknown as { __WAOC_CHECK_CONN__?: Connection; __WAOC_CHECK_RPC__?: string };
  const rpc = getRpc();
  if (!g.__WAOC_CHECK_CONN__ || g.__WAOC_CHECK_RPC__ !== rpc) {
    g.__WAOC_CHECK_CONN__ = new Connection(rpc, "confirmed");
    g.__WAOC_CHECK_RPC__ = rpc;
  }
  return g.__WAOC_CHECK_CONN__!;
}

async function getWaocBalanceUi(wallet: string) {
  const connection = getConn();
  const owner = new PublicKey(wallet);
  const mint = getWaocMint();
  const ata = await getAssociatedTokenAddress(mint, owner);

  // ATA 不存在/未创建 → 当作 0
  try {
    const bal = await connection.getTokenAccountBalance(ata);
    return bal.value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { wallet?: string };
    const wallet = s(body.wallet || "", 128).trim();
    if (!wallet) return noStoreJson({ ok: false, error: "missing_wallet" }, 400);

    const required = getMinHold();
    const balance = await getWaocBalanceUi(wallet);

    // ✅ 统一：不满足直接 403，给前端弹窗用
    if (required > 0 && balance < required) {
      return noStoreJson(
        { ok: false, error: "waoc_required", required, balance, eligible: false },
        403
      );
    }

    return noStoreJson({ ok: true, eligible: true, required, balance }, 200);
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message ?? "check_error" }, 500);
  }
}
