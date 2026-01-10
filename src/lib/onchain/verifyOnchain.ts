import type { Mission, OnchainRequirement } from "@/lib/mission/types";

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

export async function verifyOnchainMission(mission: Mission, address: string) {
  if (!address) {
    return { ok: false, reason: "Connect wallet first." } as const;
  }

  const onchain = mission.onchain;
  const verifyType = mapOnchainToVerifyType(onchain);

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

    // ✅ mint: 占位/空 -> 不传（后端会用 WAOC_MINT env）
    if (!isPlaceholderValue(mintFromMission)) {
      payload.mint = mintFromMission;
    }

    payload.minAmount = minAmount;
  }

  if (verifyType === "NFT_COLLECTION") {
    const collectionFromMission =
      onchain && onchain.kind === "nft" ? String(onchain.collection || "").trim() : "";

    // ✅ collectionMint: 占位/空 -> 不传（后端会用 WAOC_GENESIS_COLLECTION_MINT env）
    if (!isPlaceholderValue(collectionFromMission)) {
      payload.collectionMint = collectionFromMission;
    }
  }

  // （可选）debug：你要上线可以删
  console.log("[verify-onchain payload]", {
    missionId: String(mission.id || ""),
    title: String(mission.title || ""),
    payload,
  });

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
