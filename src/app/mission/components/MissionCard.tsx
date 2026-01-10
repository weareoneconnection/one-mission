"use client";

import React, { useMemo, useState } from "react";
import type { Mission } from "@/lib/mission/types";
import { useMission } from "@/lib/mission/store";

function parsePeriod(id: string): "daily" | "weekly" | "once" {
  const s = (id || "").trim();
  const idx = s.indexOf(":");
  if (idx > 0) {
    const p = s.slice(0, idx).toLowerCase();
    if (p === "daily" || p === "weekly" || p === "once") return p as any;
  }
  return "once";
}

function periodLabel(p: "daily" | "weekly" | "once") {
  if (p === "daily") return "Daily";
  if (p === "weekly") return "Weekly";
  return "Once";
}

function statusLabel(status: Mission["status"], period: "daily" | "weekly" | "once") {
  if (status === "cooldown") return "Verifying";
  if (status === "locked") return "Locked";
  if (status === "completed") {
    if (period === "daily") return "Claimed (Today)";
    if (period === "weekly") return "Claimed (This Week)";
    return "Completed";
  }
  return "Available";
}

function Pill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "success" | "warn" | "muted";
}) {
  const cls =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "muted"
      ? "border-zinc-900/10 bg-white/60 text-zinc-600"
      : "border-zinc-900/10 bg-white text-zinc-800";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${cls}`}>
      {children}
    </span>
  );
}

function OnchainInfo({ mission }: { mission: Mission }) {
  const oc: any = (mission as any).onchain;
  if (!oc) return null;

  const kind = String(oc.kind || "").toLowerCase();
  if (kind === "sol") {
    const lamports = typeof oc.minLamports === "number" ? oc.minLamports : 0;
    const sol = lamports ? lamports / 1_000_000_000 : 0.1;
    return (
      <div className="text-xs text-zinc-600">
        On-chain: Hold ≥ <b>{sol.toFixed(2)} SOL</b>
      </div>
    );
  }
  if (kind === "spl") {
    const minAmount = typeof oc.minAmount === "number" ? oc.minAmount : 0;
    return (
      <div className="text-xs text-zinc-600">
        On-chain: Hold ≥ <b>{minAmount.toLocaleString("en-US")} WAOC</b>
      </div>
    );
  }
  if (kind === "nft") {
    return (
      <div className="text-xs text-zinc-600">
        On-chain: Own <b>WAOC Genesis NFT</b>
      </div>
    );
  }
  return null;
}

export default function MissionCard({
  mission,
  onVerify,
}: {
  mission: Mission;
  onVerify: () => void;
}) {
  const { errors, walletAddress } = useMission();
  const err = errors[mission.id];

  const [dismissedError, setDismissedError] = useState(false);

  const period = useMemo(() => parsePeriod(mission.id), [mission.id]);

  const isLocked = mission.status === "locked";
  const isCompleted = mission.status === "completed";
  const isVerifying = mission.status === "cooldown";
  const canVerify = !isLocked && !isCompleted && !isVerifying;

  // 如果错误变了，自动重新显示
  const showError = useMemo(() => {
    if (!err) return false;
    if (dismissedError) return false;
    return true;
  }, [err, dismissedError]);

  const tone =
    isCompleted ? "success" : isLocked ? "warn" : isVerifying ? "muted" : "default";

  const ctaLabel = isVerifying
    ? "Verifying…"
    : isLocked
    ? "Locked"
    : isCompleted
    ? "Claimed"
    : period === "daily"
    ? "Claim (Daily)"
    : period === "weekly"
    ? "Claim (Weekly)"
    : "Verify";

  const badgeStatus = statusLabel(mission.status, period);

  return (
    <div
      className={[
        "rounded-2xl border border-zinc-900/10 bg-white/70 p-5",
        isCompleted ? "opacity-[0.92]" : "",
      ].join(" ")}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        {/* Left */}
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Pill>{mission.category}</Pill>
            <Pill tone="muted">{periodLabel(period)}</Pill>
            <Pill tone={tone}>{badgeStatus}</Pill>
            <Pill>+{mission.basePoints} pts</Pill>
          </div>

          <div className="text-base md:text-lg font-semibold text-zinc-900">
            {mission.title}
          </div>

          {mission.description ? (
            <div className="text-sm text-zinc-600 leading-relaxed">
              {mission.description}
            </div>
          ) : null}

          <OnchainInfo mission={mission} />

          {/* Wallet hint (only when needed) */}
          {!walletAddress && (mission as any).onchain ? (
            <div className="text-xs text-zinc-500">
              Tip: connect wallet before verifying on-chain missions.
            </div>
          ) : null}

          {/* Reset hint */}
          {period !== "once" ? (
            <div className="text-[11px] text-zinc-500">
              Resets {period === "daily" ? "daily at 00:00 UTC" : "weekly (UTC)"}.
            </div>
          ) : null}
        </div>

        {/* Right action */}
        <div className="shrink-0 flex items-center gap-2 md:flex-col md:items-end">
          {isCompleted ? (
            <span className="inline-flex items-center justify-center rounded-xl border border-zinc-900/10 bg-white px-5 py-2 text-sm font-semibold text-zinc-700">
              {period === "daily" ? "Claimed Today" : period === "weekly" ? "Claimed This Week" : "Verified"}
            </span>
          ) : (
            <button
              type="button"
              disabled={!canVerify}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onVerify();
              }}
              className={[
                "inline-flex items-center justify-center rounded-xl px-5 py-2 text-sm font-semibold transition",
                canVerify
                  ? "bg-black text-white hover:bg-black/90"
                  : "bg-zinc-200 text-zinc-500 cursor-not-allowed",
              ].join(" ")}
            >
              {ctaLabel}
            </button>
          )}

          <div className="hidden md:block text-xs text-zinc-500">
            {isVerifying ? "Please wait…" : isLocked ? "Not eligible yet" : " "}
          </div>
        </div>
      </div>

      {/* Error box (dismissible) */}
      {showError ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50/70 px-4 py-3 text-sm text-red-800 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Verification failed</div>
            <div className="text-red-800/80">{err}</div>
          </div>
          <button
            type="button"
            onClick={() => setDismissedError(true)}
            className="shrink-0 text-xs underline text-red-700"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
