"use client";

import React, { useMemo, useState } from "react";
import type { Mission } from "@/lib/mission/types";
import { useMission } from "@/lib/mission/store";

function statusLabel(status: Mission["status"]) {
  if (status === "completed") return "Completed";
  if (status === "cooldown") return "Verifying";
  if (status === "locked") return "Locked";
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
            <Pill tone={tone}>{statusLabel(mission.status)}</Pill>
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

          {/* Wallet hint (only when needed) */}
          {!walletAddress ? (
            <div className="text-xs text-zinc-500">
              Tip: connect wallet before verifying on-chain missions.
            </div>
          ) : null}
        </div>

        {/* Right action */}
        <div className="shrink-0 flex items-center gap-2 md:flex-col md:items-end">
          {isCompleted ? (
            <span className="inline-flex items-center justify-center rounded-xl border border-zinc-900/10 bg-white px-5 py-2 text-sm font-semibold text-zinc-700">
              Verified
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
              {isVerifying ? "Verifying…" : isLocked ? "Locked" : "Verify"}
            </button>
          )}

          {/* Secondary tiny status (optional) */}
          <div className="hidden md:block text-xs text-zinc-500">
            {isVerifying ? "Please wait…" : isLocked ? "Not eligible yet" : " "}
          </div>
        </div>
      </div>

      {/* Error box (dismissible, product-style) */}
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
