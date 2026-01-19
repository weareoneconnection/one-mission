import type { Mission, OnchainRequirement } from "@/lib/mission/types";
import bs58 from "bs58";

export type VerifyType = "SOL" | "SPL" | "NFT_COLLECTION";

export type VerifyResponse =
  | { ok: true; verifyType: VerifyType; address: string; details: any }
  | {
      ok: false;
      verifyType: VerifyType;
      address: string;
      error: string;
      details?: any;
    };

function isVerifyResponse(x: any): x is VerifyResponse {
  return (
    x &&
    typeof x === "object" &&
    typeof x.ok === "boolean" &&
    typeof x.verifyType === "string" &&
    typeof x.address === "string"
  );
}

function getVerifyError(x: VerifyResponse | null, raw: any): string | undefined {
  if (x && x.ok === false) return x.error;
  if (raw && typeof raw === "object" && typeof raw.error === "string") return raw.error;
  return undefined;
}

function mapOnchainToVerifyType(onchain?: OnchainRequirement): VerifyType {
  if (!onchain) return "SPL";
  if (onchain.kind === "sol") return "SOL";
  if (onchain.kind === "spl") return "SPL";
  if (onchain.kind === "nft") return "NFT_COLLECTION";
  return "SPL";
}

// ✅ 识别各种占位：WAOC_MINT_ADDRESS_HERE / ENV:xxx / 空字符串
function isPlaceholderValue(v: string) {
  const s = (v || "").trim();
  if (!s) return true;
  if (/^ENV:/i.test(s)) return true;
  if (/WAOC_MINT_ADDRESS_HERE/i.test(s)) return true;
  if (/MINT_ADDRESS_HERE/i.test(s)) return true;
  if (/COLLECTION_ADDRESS_HERE/i.test(s)) return true;
  if (/GENESIS_COLLECTION_ADDRESS_HERE/i.test(s)) return true;
  return false;
}

// -----------------------------
// ✅ Server-side RPC verifier
// -----------------------------
const RPC_URL = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "";
const WAOC_MINT = process.env.WAOC_MINT || process.env.NEXT_PUBLIC_WAOC_MINT || "";
const COLLECTION_MINT =
  process.env.WAOC_GENESIS_COLLECTION_MINT || process.env.NEXT_PUBLIC_WAOC_GENESIS_COLLECTION_MINT || "";

function isValidSolanaPubkey(s: string) {
  try {
    const bytes = bs58.decode(s);
    return bytes.length === 32;
  } catch {
    return false;
  }
}

function isHeliusRpc(url: string) {
  return /helius/i.test(url) || /api\.helius\.xyz/i.test(url) || /rpc\.helius\.xyz/i.test(url) || /helius-rpc\.com/i.test(url);
}

async function rpcCall<T>(method: string, params: any, timeoutMs = 15000): Promise<T> {
  if (!RPC_URL) throw new Error("SOLANA_RPC_URL not set.");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}

    if (!res.ok) {
      const msg = json?.error?.message || text || `HTTP ${res.status}`;
      throw new Error(`RPC ${res.status}: ${msg}`);
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
  const r = await rpcCall<{ value: number }>("getBalance", [address, { commitment: "confirmed" }]);
  return r.value / 1_000_000_000;
}

async function getSplBalance(address: string, mint: string) {
  const r = await rpcCall<{
    value: Array<{
      account: { data: { parsed: { info: { tokenAmount: { amount: string; decimals: number; uiAmount: number | null } } } } };
    }>;
  }>("getTokenAccountsByOwner", [address, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);

  let total = 0;
  let decimals = 0;

  for (const it of r.value || []) {
    const ta = it.account.data.parsed.info.tokenAmount;
    decimals = ta.decimals;
    const ui = ta.uiAmount ?? Number(ta.amount) / Math.pow(10, ta.decimals);
    total += ui;
  }

  return { total, decimals, accounts: (r.value || []).length };
}

async function ownsNftInCollectionHeliusDAS(address: string, collectionMint: string) {
  if (!isHeliusRpc(RPC_URL)) {
    return { owns: false, scanned: 0, hint: "NFT_COLLECTION requires Helius DAS RPC." };
  }

  const das = await rpcCall<any>("getAssetsByOwner", {
    ownerAddress: address,
    page: 1,
    limit: 1000,
    sortBy: { sortBy: "recent_action", sortDirection: "desc" },
    displayOptions: { showCollectionMetadata: true },
  });

  const items: any[] = das?.items || [];
  const hit = items.find((it) => {
    const c = it?.grouping?.find?.((g: any) => g?.group_key === "collection");
    return String(c?.group_value || "") === String(collectionMint);
  });

  return { owns: Boolean(hit), scanned: items.length };
}

/**
 * ✅ verifyOnchainMission：前端依旧走 /api/verify-onchain
 * ✅ 服务器（/api/mission/verify）调用时：直接 RPC 校验，避免 server 自己 HTTP 打自己导致 401
 */
export async function verifyOnchainMission(mission: Mission, address: string) {
  if (!address) {
    return { ok: false, reason: "Connect wallet first." } as const;
  }

  const onchain = mission.onchain;
  const verifyType = mapOnchainToVerifyType(onchain);

  // -----------------------------
  // ✅ Server path: direct RPC verify
  // -----------------------------
  if (typeof window === "undefined") {
    try {
      if (!isValidSolanaPubkey(address)) return { ok: false, reason: "Invalid wallet address" } as const;

      if (verifyType === "SOL") {
        const minLamports =
          onchain && onchain.kind === "sol" && typeof onchain.minLamports === "number"
            ? onchain.minLamports
            : 0.1 * 1_000_000_000;
        const minSol = minLamports / 1_000_000_000;
        const bal = await getSolBalanceSol(address);
        if (bal + 1e-12 >= minSol) return { ok: true } as const;
        return { ok: false, reason: `Need ≥ ${minSol.toFixed(2)} SOL` } as const;
      }

      if (verifyType === "SPL") {
        const mintFromMission = onchain && onchain.kind === "spl" ? String(onchain.mint || "").trim() : "";
        const mint = !isPlaceholderValue(mintFromMission) ? mintFromMission : String(WAOC_MINT || "").trim();

        const minAmount =
          onchain && onchain.kind === "spl" && typeof onchain.minAmount === "number"
            ? onchain.minAmount
            : 10_000;

        if (!mint) return { ok: false, reason: "Missing mint" } as const;
        if (!isValidSolanaPubkey(mint)) return { ok: false, reason: "Invalid mint" } as const;

        const { total } = await getSplBalance(address, mint);
        if (total + 1e-12 >= minAmount) return { ok: true } as const;
        return { ok: false, reason: `Need ≥ ${minAmount} tokens` } as const;
      }

      if (verifyType === "NFT_COLLECTION") {
        const collectionFromMission = onchain && onchain.kind === "nft" ? String((onchain as any).collection || "").trim() : "";
        const collectionMint = !isPlaceholderValue(collectionFromMission)
          ? collectionFromMission
          : String(COLLECTION_MINT || "").trim();

        if (!collectionMint) return { ok: false, reason: "Missing collectionMint" } as const;
        if (!isValidSolanaPubkey(collectionMint)) return { ok: false, reason: "Invalid collectionMint" } as const;

        const { owns } = await ownsNftInCollectionHeliusDAS(address, collectionMint);
        if (owns) return { ok: true } as const;
        return { ok: false, reason: "NFT not found in collection" } as const;
      }

      return { ok: false, reason: "Unsupported onchain kind" } as const;
    } catch (e: any) {
      // ✅ 把真实错误暴露出来（RPC 401/403/429）
      return { ok: false, reason: String(e?.message || e || "onchain_error") } as const;
    }
  }

  // -----------------------------
  // ✅ Browser path: call API
  // -----------------------------
  // ✅ 后端需要：address + verifyType + (minSol | mint+minAmount | collectionMint)
  // ✅ 关键升级：mint/collection 如果是占位，直接不传，让后端用 env fallback
  const payload: any = { address, verifyType };

  if (verifyType === "SOL") {
    const minLamports =
      onchain && onchain.kind === "sol" && typeof onchain.minLamports === "number"
        ? onchain.minLamports
        : 0.1 * 1_000_000_000;

    payload.minSol = minLamports / 1_000_000_000;
  }

  if (verifyType === "SPL") {
    const mintFromMission =
      onchain && onchain.kind === "spl" ? String(onchain.mint || "").trim() : "";

    const minAmount =
      onchain && onchain.kind === "spl" && typeof onchain.minAmount === "number"
        ? onchain.minAmount
        : 10_000;

    if (!isPlaceholderValue(mintFromMission)) {
      payload.mint = mintFromMission;
    }

    payload.minAmount = minAmount;
  }

  if (verifyType === "NFT_COLLECTION") {
    const collectionFromMission =
      onchain && onchain.kind === "nft" ? String((onchain as any).collection || "").trim() : "";

    if (!isPlaceholderValue(collectionFromMission)) {
      payload.collectionMint = collectionFromMission;
    }
  }

  const res = await fetch("/api/verify-onchain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const raw = await res.json().catch(() => null);
  const data = isVerifyResponse(raw) ? raw : null;

  if (!res.ok) {
    return {
      ok: false,
      reason: getVerifyError(data, raw) || `HTTP ${res.status}`,
    } as const;
  }

  if (data?.ok) return { ok: true } as const;

  return {
    ok: false,
    reason: getVerifyError(data, raw) || "Verification failed.",
  } as const;
}
