"use client";

import React from "react";
import Link from "next/link";
import { useMission } from "@/lib/mission/store";

function mask(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export default function MissionShell({ children }: { children: React.ReactNode }) {
  const { walletAddress, connecting, connectWallet, disconnectWallet } = useMission();

  return (
    <div className="min-h-screen bg-[#f7f6f2] text-zinc-900">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        {/* Top bar */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm tracking-widest text-zinc-600">WAOC</div>
            <h1 className="mt-1 text-2xl font-semibold">ONE Mission</h1>
            <div className="mt-1 text-sm text-zinc-700">
              Missions → Points → Rank → Rewards (Season System)
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* ✅ 真正 Home（/） */}
            <Link
              href="/"
              className="rounded-xl border border-zinc-900/10 bg-white/70 px-4 py-2 text-sm hover:bg-white"
            >
              Home
            </Link>

            {/* ✅ 活动入口（/mission/overview） */}
            <Link
              href="/mission/overview"
              className="rounded-xl border border-zinc-900/10 bg-white/70 px-4 py-2 text-sm hover:bg-white"
            >
              Overview
            </Link>

            {walletAddress ? (
              <button
                type="button"
                onClick={disconnectWallet}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white hover:opacity-90"
              >
                {mask(walletAddress)} · Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={connectWallet}
                disabled={connecting}
                className={[
                  "rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white",
                  connecting ? "opacity-60 cursor-not-allowed" : "hover:opacity-90",
                ].join(" ")}
              >
                {connecting ? "Connecting…" : "Connect Wallet"}
              </button>
            )}
          </div>
        </div>

        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
