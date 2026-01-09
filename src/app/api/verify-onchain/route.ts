import { NextResponse } from "next/server";
import bs58 from "bs58";

type VerifyType = "SOL" | "SPL" | "NFT_COLLECTION";

type VerifyRequest = {
  address?: string;
  verifyType?: VerifyType;

  // SOL
  minSol?: number;

  // SPL
  mint?: string;
  minAmount?: number;

  // NFT collection
  collectionMint?: string;
};

type VerifyResult =
  | {
      ok: true;
      verifyType: VerifyType;
      address: string;
      details: Record<string, any>;
    }
  | {
      ok: false;
      verifyType: VerifyType;
      address: string;
      error: string;
      details?: Record<string, any>;
    };

const RPC_URL = process.env.SOLANA_RPC_URL || "";
const WAOC_MINT = process.env.WAOC_MINT || "";
const COLLECTION_MINT = process.env.WAOC_GENESIS_COLLECTION_MINT || "";

// ---------- helpers ----------
function isValidSolanaPubkey(s: string) {
  try {
    const bytes = bs58.decode(s);
    return bytes.length === 32;
  } catch {
    return false;
  }
}

function isHeliusRpc(url: string) {
  return /helius/i.test(url) || /api\.helius\.xyz/i.test(url);
}

async function rpcCall<T>(method: string, params: any[] = [], timeoutMs = 12000): Promise<T> {
  if (!RPC_URL) throw new Error("SOLANA_RPC_URL not set.");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(json?.error?.message || `RPC HTTP ${res.status}`);
    }
    if (json?.error) {
      throw new Error(json.error?.message || "RPC error");
    }
    return json.result as T;
  } finally {
    clearTimeout(t);
  }
}

async function getSolBalanceSol(address: string) {
  const result = await rpcCall<{ value: number }>("getBalance", [address, { commitment: "confirmed" }]);
  return result.value / 1_000_000_000;
}

async function getSplBalance(address: string, mint: string) {
  const result = await rpcCall<{
    value: Array<{
      account: {
        data: {
          parsed: {
            info: {
              tokenAmount: {
                amount: string;
                decimals: number;
                uiAmount: number | null;
                uiAmountString: string;
              };
              mint: string;
            };
          };
        };
      };
    }>;
  }>("getTokenAccountsByOwner", [
    address,
    { mint },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);

  let total = 0;
  let decimals = 0;

  for (const item of result.value || []) {
    const ta = item.account.data.parsed.info.tokenAmount;
    decimals = ta.decimals;
    const ui = ta.uiAmount ?? Number(ta.amount) / Math.pow(10, ta.decimals);
    total += ui;
  }

  return { total, decimals, accounts: (result.value || []).length };
}

async function ownsNftInCollectionHeliusDAS(address: string, collectionMint: string) {
  // Only works on Helius DAS
  const das = await rpcCall<any>("getAssetsByOwner", [
    {
      ownerAddress: address,
      page: 1,
      limit: 1000,
      displayOptions: { showCollectionMetadata: true },
    },
  ]);

  const items: any[] = das?.items || [];
  const hit = items.find((it) => {
    const c = it?.grouping?.find?.((g: any) => g?.group_key === "collection");
    return c?.group_value === collectionMint;
  });

  return { owns: Boolean(hit), scanned: items.length };
}

// ---------- route ----------
export async function POST(req: Request) {
  // 1) parse JSON
  let parsed: VerifyRequest;
  try {
    parsed = (await req.json()) as VerifyRequest;
  } catch {
    const r: VerifyResult = {
      ok: false,
      verifyType: "SOL",
      address: "",
      error: "Invalid JSON body",
    };
    return NextResponse.json(r, { status: 400 });
  }

  // ✅ 从这里开始 body 一定非空
  const body = parsed;

  const verifyType = body.verifyType;
  const address = String(body.address || "").trim();

  // 2) basic validation
  if (!verifyType || !["SOL", "SPL", "NFT_COLLECTION"].includes(verifyType)) {
    const r: VerifyResult = {
      ok: false,
      verifyType: (verifyType as VerifyType) || "SOL",
      address,
      error: "Invalid verifyType",
    };
    return NextResponse.json(r, { status: 400 });
  }

  if (!address || !isValidSolanaPubkey(address)) {
    const r: VerifyResult = {
      ok: false,
      verifyType,
      address,
      error: "Invalid wallet address",
    };
    return NextResponse.json(r, { status: 400 });
  }

  if (!RPC_URL) {
    const r: VerifyResult = {
      ok: false,
      verifyType,
      address,
      error: "SOLANA_RPC_URL not set.",
    };
    return NextResponse.json(r, { status: 500 });
  }

  // 3) required fields validation (关键：缺字段直接 400 + 明确提示)
  if (verifyType === "SOL") {
    const minSol = body.minSol;
    if (minSol != null && typeof minSol !== "number") {
      const r: VerifyResult = { ok: false, verifyType, address, error: "minSol must be a number" };
      return NextResponse.json(r, { status: 400 });
    }
  }

  if (verifyType === "SPL") {
    const mint = String((body.mint || WAOC_MINT || "")).trim();
    const minAmount = body.minAmount;

    if (!mint) {
      const r: VerifyResult = { ok: false, verifyType, address, error: "Missing mint" };
      return NextResponse.json(r, { status: 400 });
    }
    if (!isValidSolanaPubkey(mint)) {
      const r: VerifyResult = { ok: false, verifyType, address, error: "Invalid mint", details: { mint } };
      return NextResponse.json(r, { status: 400 });
    }
    if (minAmount != null && typeof minAmount !== "number") {
      const r: VerifyResult = { ok: false, verifyType, address, error: "minAmount must be a number" };
      return NextResponse.json(r, { status: 400 });
    }
  }

  if (verifyType === "NFT_COLLECTION") {
    const collectionMint = String((body.collectionMint || COLLECTION_MINT || "")).trim();

    if (!collectionMint) {
      const r: VerifyResult = { ok: false, verifyType, address, error: "Missing collectionMint" };
      return NextResponse.json(r, { status: 400 });
    }
    if (!isValidSolanaPubkey(collectionMint)) {
      const r: VerifyResult = {
        ok: false,
        verifyType,
        address,
        error: "Invalid collectionMint",
        details: { collectionMint },
      };
      return NextResponse.json(r, { status: 400 });
    }

    if (!isHeliusRpc(RPC_URL)) {
      const r: VerifyResult = {
        ok: false,
        verifyType,
        address,
        error: "NFT_COLLECTION requires Helius DAS RPC (getAssetsByOwner). Please use Helius SOLANA_RPC_URL.",
        details: { rpc: RPC_URL, collectionMint },
      };
      return NextResponse.json(r, { status: 400 });
    }
  }

  // 4) business logic
  try {
    // --- SOL ---
    if (verifyType === "SOL") {
      const minSol = typeof body.minSol === "number" ? body.minSol : 0.1;
      const bal = await getSolBalanceSol(address);

      if (bal + 1e-12 >= minSol) {
        const r: VerifyResult = { ok: true, verifyType, address, details: { balanceSol: bal, minSol } };
        return NextResponse.json(r);
      }

      const r: VerifyResult = {
        ok: false,
        verifyType,
        address,
        error: `Need ≥ ${minSol.toFixed(2)} SOL`,
        details: { balanceSol: bal, minSol },
      };
      return NextResponse.json(r);
    }

    // --- SPL ---
    if (verifyType === "SPL") {
      const mint = String((body.mint || WAOC_MINT || "")).trim();
      const minAmount = typeof body.minAmount === "number" ? body.minAmount : 10_000;

      const { total, decimals, accounts } = await getSplBalance(address, mint);

      if (total + 1e-12 >= minAmount) {
        const r: VerifyResult = {
          ok: true,
          verifyType,
          address,
          details: { mint, total, minAmount, decimals, accounts },
        };
        return NextResponse.json(r);
      }

      const r: VerifyResult = {
        ok: false,
        verifyType,
        address,
        error: `Need ≥ ${minAmount} tokens`,
        details: { mint, total, minAmount, decimals, accounts },
      };
      return NextResponse.json(r);
    }

    // --- NFT_COLLECTION ---
    if (verifyType === "NFT_COLLECTION") {
      const collectionMint = String((body.collectionMint || COLLECTION_MINT || "")).trim();

      const { owns, scanned } = await ownsNftInCollectionHeliusDAS(address, collectionMint);

      if (owns) {
        const r: VerifyResult = {
          ok: true,
          verifyType,
          address,
          details: { collectionMint, owns, scanned, method: "helius_das" },
        };
        return NextResponse.json(r);
      }

      const r: VerifyResult = {
        ok: false,
        verifyType,
        address,
        error: "NFT not found in collection",
        details: { collectionMint, owns, scanned, method: "helius_das" },
      };
      return NextResponse.json(r);
    }

    const r: VerifyResult = { ok: false, verifyType, address, error: "Unsupported verifyType" };
    return NextResponse.json(r, { status: 400 });
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    const r: VerifyResult = { ok: false, verifyType, address, error: `RPC error: ${msg}` };
    return NextResponse.json(r, { status: 500 });
  }
}
