"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Mission } from "./types";
import { mockMissions } from "./mock";
import { verifyOnchainMission } from "@/lib/onchain/verifyOnchain";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

type MissionState = {
  missions: Mission[];
  points: number;
  completedCount: number;

  walletAddress: string | null;
  connecting: boolean;
  connected: boolean;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;

  verifyingId: string | null;
  errors: Record<string, string | undefined>;

  verify: (id: string) => void;
  reset: () => void;
  resetAll: () => void;
};

const MissionContext = createContext<MissionState | null>(null);

// ✅ 任务定义（永远不写 completed），completed 由 KV 的 completedIds 决定
const baseMissions: Mission[] = mockMissions.map((m) => ({
  ...m,
  status: m.status === "completed" ? "available" : m.status,
}));

/** -----------------------------
 *  Response Types (兼容字段)
 * ------------------------------ */
type StatsResponse = {
  ok: boolean;
  wallet: string;
  points?: number;
  totalPoints?: number;
  completed?: number;
  completedCount?: number;
  completedIds?: string[];
  error?: string;
};

type VerifyResponse = {
  ok: boolean;
  wallet: string;
  missionId: string;

  // ✅ 兼容：后端可能返回 totalPoints / points
  points?: number;
  totalPoints?: number;

  // ✅ 兼容：completed / completedCount
  completed?: number;
  completedCount?: number;

  // ✅ 兼容：duplicated / alreadyVerified
  duplicated?: boolean;
  alreadyVerified?: boolean;

  // optional
  pointsAdded?: number;
  total?: number;

  error?: string;
};

function pickNumber(...vals: any[]) {
  for (const v of vals) if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

export function MissionProvider({ children }: { children: React.ReactNode }) {
  const { publicKey, connected, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const walletAddress = useMemo(
    () => (publicKey ? publicKey.toBase58() : null),
    [publicKey]
  );

  // ✅ UI 状态：完成列表（最好来自 KV）
  const [completedByWallet, setCompletedByWallet] = useState<
    Record<string, string[]>
  >({});

  // ✅ 权威 stats：来自 KV
  const [statsByWallet, setStatsByWallet] = useState<
    Record<string, { points: number; completed: number }>
  >({});

  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const completedIds = useMemo(() => {
    if (!walletAddress) return [];
    return completedByWallet[walletAddress] ?? [];
  }, [completedByWallet, walletAddress]);

  const points = useMemo(() => {
    if (!walletAddress) return 0;
    return statsByWallet[walletAddress]?.points ?? 0;
  }, [statsByWallet, walletAddress]);

  const completedCount = useMemo(() => {
    if (!walletAddress) return 0;
    return statsByWallet[walletAddress]?.completed ?? 0;
  }, [statsByWallet, walletAddress]);

  const missions = useMemo(() => {
    return baseMissions.map((m) => {
      if (m.status === "locked") return m;

      const isCompleted = walletAddress ? completedIds.includes(m.id) : false;
      const isVerifying = walletAddress ? verifyingId === m.id : false;

      if (isVerifying) return { ...m, status: "cooldown" as const };
      if (isCompleted) return { ...m, status: "completed" as const };
      return { ...m, status: "available" as const };
    });
  }, [completedIds, verifyingId, walletAddress]);

  const connectWallet = async () => setVisible(true);

  const disconnectWallet = async () => {
    await disconnect();
    setErrors({});
    setVerifyingId(null);
  };

  const markCompletedForWallet = (wallet: string, missionId: string) => {
    setCompletedByWallet((prev) => {
      const list = prev[wallet] ?? [];
      if (list.includes(missionId)) return prev;
      return { ...prev, [wallet]: [...list, missionId] };
    });
  };

  const setCompletedIdsForWallet = (wallet: string, ids: string[]) => {
    setCompletedByWallet((prev) => ({ ...prev, [wallet]: ids }));
  };

  const setStatsForWallet = (wallet: string, p: number, c: number) => {
    setStatsByWallet((prev) => ({
      ...prev,
      [wallet]: { points: p, completed: c },
    }));
  };

  /** ✅ 拉 stats（永远兼容 points/totalPoints & completed/completedCount） */
  const refreshStats = async (wallet: string) => {
    if (!wallet) return;

    const r = await fetch(`/api/mission/stats?wallet=${wallet}`, {
      method: "GET",
      cache: "no-store",
    });

    const j = (await r.json().catch(() => ({}))) as StatsResponse;

    if (r.ok && j?.ok) {
      const nextPoints = pickNumber(j.points, j.totalPoints);
      const nextCompleted = pickNumber(j.completed, j.completedCount);

      setStatsForWallet(wallet, nextPoints, nextCompleted);

      if (Array.isArray(j.completedIds)) {
        setCompletedIdsForWallet(wallet, j.completedIds);
      }
      return { ok: true as const, j };
    }

    // ❗不要把已有 stats 强制清 0（否则会闪成 0）
    return { ok: false as const, j };
  };

  // ✅ wallet 变化自动刷新 stats
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!walletAddress) return;
      try {
        const res = await refreshStats(walletAddress);
        if (cancelled) return;

        // 如果后端失败，也不要改成 0；保持现状即可
        if (!res.ok) {
          // 可选：记录错误，但不覆盖 points
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  // ✅ 后端写 KV
  async function postVerifyToServer(wallet: string, mission: Mission) {
    const r = await fetch("/api/mission/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        walletAddress: wallet, // ✅ 最兼容
        wallet, // ✅ 兼容另一种写法
        missionId: mission.id,
        points: mission.basePoints,
      }),
    });

    const j = (await r.json().catch(() => ({}))) as VerifyResponse;
    if (!r.ok || !j?.ok) throw new Error(j?.error || "Server verify failed.");
    return j;
  }

  const verify = (id: string) => {
    (async () => {
      const m = baseMissions.find((x) => x.id === id);
      if (!m) return;

      setErrors((prev) => ({ ...prev, [id]: undefined }));

      if (m.status === "locked") return;
      if (verifyingId === id) return;

      if (!walletAddress) {
        setErrors((prev) => ({ ...prev, [id]: "Connect wallet first." }));
        setVisible(true);
        return;
      }

      // ✅ 已完成直接返回（以 completedIds 去重）
      if (completedIds.includes(id)) return;

      const isOnchain = Boolean((m as any).onchain);
      setVerifyingId(id);

      try {
        // 1) onchain 任务先校验
        if (isOnchain) {
          const res = await verifyOnchainMission(m, walletAddress);
          if (!res.ok) {
            setErrors((prev) => ({
              ...prev,
              [id]: res.reason ?? "Verification failed.",
            }));
            return;
          }
        }

        // 2) 写 KV
        const j = await postVerifyToServer(walletAddress, m);

        // 3) ✅ 不要再盲写 j.points（可能不存在）
        //    先兼容读取，再写入；写完后再强制 refreshStats 兜底
        const nextPoints = pickNumber(j.points, j.totalPoints);
        const nextCompleted = pickNumber(j.completed, j.completedCount);

        if (nextPoints || nextCompleted) {
          setStatsForWallet(walletAddress, nextPoints, nextCompleted);
        }

        // 4) UI 完成态（立刻让卡片变 Verified）
        markCompletedForWallet(walletAddress, id);

        // 5) ✅ 强制刷新 stats（拿到最终 points/completedIds，彻底一致）
        await refreshStats(walletAddress);
      } catch (e: any) {
        setErrors((prev) => ({
          ...prev,
          [id]: e?.message ?? "Verification error.",
        }));
      } finally {
        setVerifyingId(null);
      }
    })();
  };

  // ✅ 本地 reset（不影响 KV）
  const reset = () => {
    if (!walletAddress) return;
    setCompletedByWallet((prev) => {
      const next = { ...prev };
      delete next[walletAddress];
      return next;
    });
    setStatsByWallet((prev) => {
      const next = { ...prev };
      delete next[walletAddress];
      return next;
    });
    setErrors({});
    setVerifyingId(null);
  };

  const resetAll = () => {
    setCompletedByWallet({});
    setStatsByWallet({});
    setErrors({});
    setVerifyingId(null);
  };

  const value: MissionState = {
    missions,
    points,
    completedCount,

    walletAddress,
    connecting,
    connected,
    connectWallet,
    disconnectWallet,

    verifyingId,
    errors,
    verify,
    reset,
    resetAll,
  };

  return (
    <MissionContext.Provider value={value}>{children}</MissionContext.Provider>
  );
}

export function useMission() {
  const ctx = useContext(MissionContext);
  if (!ctx) throw new Error("useMission must be used within MissionProvider");
  return ctx;
}
