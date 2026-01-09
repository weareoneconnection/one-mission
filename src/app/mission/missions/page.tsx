"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import MissionCard from "../components/MissionCard";
import MissionFilters from "../components/MissionFilters";
import { useMission } from "@/lib/mission/store";
import type { Mission } from "@/lib/mission/types";

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-4">
      <div className="text-xs text-zinc-600">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-600">{hint}</div> : null}
    </div>
  );
}

export default function MissionsPage() {
  const {
    missions,
    verify,
    points,
    completedCount,
    reset,

    walletAddress,
    connecting,
    connectWallet,
    disconnectWallet,
  } = useMission();

  const [category, setCategory] = useState<"all" | Mission["category"]>("all");
  const [status, setStatus] = useState<"all" | Mission["status"]>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"default" | "points_desc" | "points_asc">(
    "default"
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = missions.filter((m) => {
      if (category !== "all" && m.category !== category) return false;
      if (status !== "all" && m.status !== status) return false;
      if (q) {
        const hay = `${m.title} ${m.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sort === "points_desc")
      list = [...list].sort((a, b) => b.basePoints - a.basePoints);
    if (sort === "points_asc")
      list = [...list].sort((a, b) => a.basePoints - b.basePoints);

    return list;
  }, [missions, category, status, query, sort]);

  const shortWallet = useMemo(() => {
    if (!walletAddress) return "";
    return `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
  }, [walletAddress]);

  const progressText = `${completedCount}/${missions.length}`;

  return (
    <div className="space-y-6">
      {/* =================== 顶部执行区（不改逻辑，只升级 UI） =================== */}
      <div className="rounded-3xl border border-zinc-900/10 bg-white/70 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-medium tracking-wide text-zinc-600">
              MISSIONS
            </div>
            <h2 className="text-xl md:text-2xl font-semibold text-zinc-900">
              Execute missions & verify to earn points
            </h2>
            <p className="text-sm text-zinc-700">
              This is your execution workspace. For campaign intro & prize pool,
              go to{" "}
              <Link href="/mission/overview" className="underline">
                Overview
              </Link>
              .
            </p>

            {/* Wallet row */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-zinc-700">Wallet:</span>

              {walletAddress ? (
                <span className="rounded-full border border-zinc-900/10 bg-white px-3 py-1 font-semibold">
                  {shortWallet}
                </span>
              ) : (
                <span className="text-zinc-500">Not connected</span>
              )}

              <div className="ml-1 flex items-center gap-2">
                {!walletAddress ? (
                  <button
                    type="button"
                    onClick={connectWallet}
                    disabled={connecting}
                    className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-60"
                  >
                    {connecting ? "Connecting..." : "Connect Wallet"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={disconnectWallet}
                    className="rounded-xl border border-zinc-900/15 bg-white/60 px-3 py-2 text-sm hover:bg-white"
                  >
                    Disconnect
                  </button>
                )}

                <button
                  type="button"
                  onClick={reset}
                  className="rounded-xl border border-zinc-900/15 bg-white/60 px-3 py-2 text-sm hover:bg-white"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 md:w-[420px]">
            <StatCard label="Points" value={points} hint="Earned so far" />
            <StatCard
              label="Completed"
              value={progressText}
              hint="Verified missions"
            />
            <StatCard
              label="Showing"
              value={filtered.length}
              hint={`Total: ${missions.length}`}
            />
            <StatCard
              label="Status"
              value={walletAddress ? "Ready" : "Connect"}
              hint={walletAddress ? "You can verify" : "Wallet required"}
            />
          </div>
        </div>
      </div>

      {/* 未连接提示（更产品化 + CTA） */}
      {!walletAddress && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-50/60 p-4 text-sm text-amber-900 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-semibold">Wallet required for on-chain verify</div>
            <div className="text-amber-900/80">
              Connect your Solana wallet to verify SOL / WAOC / NFT missions.
            </div>
          </div>
          <button
            type="button"
            onClick={connectWallet}
            disabled={connecting}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-60"
          >
            {connecting ? "Connecting..." : "Connect Wallet"}
          </button>
        </div>
      )}

      {/* =================== 吸顶筛选条（不改 props） =================== */}
      <div className="sticky top-0 z-10 bg-background pt-2 pb-3">
        <MissionFilters
          category={category}
          setCategory={setCategory}
          status={status}
          setStatus={setStatus}
          query={query}
          setQuery={setQuery}
          sort={sort}
          setSort={setSort}
          total={missions.length}
          shown={filtered.length}
        />
      </div>

      {/* =================== 列表 =================== */}
      <div className="grid gap-3">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-8 text-center">
            <div className="text-base font-semibold">No missions found</div>
            <div className="mt-2 text-sm text-zinc-600">
              Try changing filters or clearing search.
            </div>
          </div>
        ) : (
          filtered.map((m) => (
            <MissionCard
              key={m.id}
              mission={m}
              onVerify={async () => {
                // ✅ 保留你的 on-chain verify 行为：没钱包 → 先连接 → 再回来点
                if (!walletAddress) {
                  await connectWallet();
                  return;
                }
                verify(m.id);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

