import type { Mission, OnchainRequirement } from "@/lib/mission/types";

export type VerifyType = "SOL" | "SPL" | "NFT_COLLECTION";

export type VerifyResponse =
  | { ok: true; verifyType: VerifyType; address: string; details: any }
  | { ok: false; verifyType: VerifyType; address: string; error: string; details?: any };

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
  if (!onchain) return "SPL"; // 兜底
  if (onchain.kind === "sol") return "SOL";
  if (onchain.kind === "spl") return "SPL";
  if (onchain.kind === "nft") return "NFT_COLLECTION";
  return "SPL";
}

function isLikelyPlaceholderMint(mint: string) {
  const s = mint.trim();
  if (!s) return true;
  if (/WAOC_MINT_ADDRESS_HERE/i.test(s)) return true;
  if (/MINT_ADDRESS_HERE/i.test(s)) return true;
  return false;
}

export async function verifyOnchainMission(mission: Mission, address: string) {
  if (!address) {
    return { ok: false, reason: "Connect wallet first." } as const;
  }

  const onchain = mission.onchain;
  const verifyType = mapOnchainToVerifyType(onchain);

  // ✅ route.ts 需要的字段：address + verifyType + (minSol | mint+minAmount | collectionMint)
  const payload: any = { address, verifyType };

  if (verifyType === "SOL") {
    // mission.onchain: { kind:"sol", minLamports }
    const minLamports =
      onchain && onchain.kind === "sol" && typeof onchain.minLamports === "number"
        ? onchain.minLamports
        : 0.1 * 1_000_000_000;
    payload.minSol = minLamports / 1_000_000_000;
  }

  if (verifyType === "SPL") {
    // mission.onchain: { kind:"spl", mint, minAmount }
    const envMint = String(process.env.NEXT_PUBLIC_WAOC_MINT || "").trim();

    const mintFromMission =
      onchain && onchain.kind === "spl" ? String(onchain.mint || "").trim() : "";

    const mint = isLikelyPlaceholderMint(mintFromMission) ? envMint : mintFromMission;

    const minAmount =
      onchain && onchain.kind === "spl" && typeof onchain.minAmount === "number"
        ? onchain.minAmount
        : 10_000;

    payload.mint = mint;
    payload.minAmount = minAmount;
  }

  if (verifyType === "NFT_COLLECTION") {
    // mission.onchain: { kind:"nft", collection }
    const envCollection = String(process.env.NEXT_PUBLIC_WAOC_GENESIS_COLLECTION_MINT || "").trim();
    const collectionFromMission =
      onchain && onchain.kind === "nft" ? String(onchain.collection || "").trim() : "";
    payload.collectionMint = collectionFromMission || envCollection;
  }

  // ✅ Debug：直接看出到底哪个 mission 发错字段
  console.log("[verify payload]", {
    missionId: String(mission.id || ""),
    title: String(mission.title || ""),
    payload,
  });
  console.log("[verify payload raw]", payload);
  console.log("[verify payload json]\n", JSON.stringify(payload, null, 2));

  const res = await fetch("/api/verify-onchain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
