"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useMission } from "@/lib/mission/store";

type Row = {
  wallet: string;
  points: number;
  completed: number;
};

type SortKey = "points" | "completed";

function mask(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-4">
      <div className="text-xs text-zinc-600">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-zinc-600">{sub}</div> : null}
    </div>
  );
}

export default function LeaderboardPage() {
  const { walletAddress } = useMission();

  const [sortKey, setSortKey] = useState<SortKey>("points");
  const [desc, setDesc] = useState(true);

  const [base, setBase] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        qs.set("sort", sortKey);
        qs.set("order", desc ? "desc" : "asc");
        if (walletAddress) qs.set("wallet", walletAddress); // ✅ 关键：把你的 Solana 地址传给 API

        const res = await fetch(`/api/leaderboard?${qs.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        const json = await res.json();
       setBase((json?.rows ?? json?.data ?? []) as Row[]);
      } catch (e) {
        // ignore abort
      } finally {
        setLoading(false);
      }
    };

    run();
    return () => controller.abort();
  }, [sortKey, desc, walletAddress]);

  const rows = useMemo(() => {
    const list = [...base];
    // API 已经排好也没关系，这里保留你原本的排序逻辑（结构不变）
    list.sort((a, b) => {
      const av = sortKey === "points" ? a.points : a.completed;
      const bv = sortKey === "points" ? b.points : b.completed;
      return desc ? bv - av : av - bv;
    });
    return list;
  }, [base, sortKey, desc]);

  const myIndex = useMemo(() => {
    if (!walletAddress) return -1;
    return rows.findIndex((r) => r.wallet === walletAddress);
  }, [rows, walletAddress]);

  const top1 = rows[0];
  const total = rows.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl border border-zinc-900/10 bg-white/70 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-medium tracking-wide text-zinc-600">
              LEADERBOARD
            </div>
            <h2 className="text-xl md:text-2xl font-semibold text-zinc-900">
              Top contributors by points & verified missions
            </h2>
            <p className="text-sm text-zinc-700">
              Rankings update as missions are verified. Your wallet (if connected) will be highlighted.
              {loading ? <span className="ml-2 text-zinc-500">(loading…)</span> : null}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:w-[420px]">
            <StatCard label="Participants" value={total} sub="Live data" />
            <StatCard
              label="Top 1"
              value={top1 ? mask(top1.wallet) : "—"}
              sub={top1 ? `${top1.points} pts · ${top1.completed} done` : "—"}
            />
            <StatCard
              label="Sort"
              value={sortKey === "points" ? "Points" : "Completed"}
              sub={desc ? "High → Low" : "Low → High"}
            />
            <StatCard
              label="You"
              value={walletAddress ? (myIndex >= 0 ? `#${myIndex + 1}` : "Not ranked") : "Connect"}
              sub={walletAddress ? mask(walletAddress) : "Wallet required"}
            />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSortKey("points")}
            className={[
              "rounded-xl border px-4 py-2 text-sm font-medium",
              sortKey === "points"
                ? "bg-black text-white border-black"
                : "bg-white/60 border-zinc-900/15 hover:bg-white",
            ].join(" ")}
          >
            Sort by Points
          </button>

          <button
            type="button"
            onClick={() => setSortKey("completed")}
            className={[
              "rounded-xl border px-4 py-2 text-sm font-medium",
              sortKey === "completed"
                ? "bg-black text-white border-black"
                : "bg-white/60 border-zinc-900/15 hover:bg-white",
            ].join(" ")}
          >
            Sort by Completed
          </button>

          <button
            type="button"
            onClick={() => setDesc((v) => !v)}
            className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm font-medium hover:bg-white"
          >
            Order: {desc ? "Desc" : "Asc"}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        {rows.map((r, i) => {
          const isMe = walletAddress && r.wallet === walletAddress;

          return (
            <div
              key={`${r.wallet}-${i}`}
              className={[
                "rounded-2xl border p-4 md:p-5 flex items-center justify-between gap-4",
                isMe ? "border-zinc-900 bg-white" : "border-zinc-900/10 bg-white/70",
              ].join(" ")}
            >
              <div className="min-w-0 flex items-center gap-3">
                <div
                  className={[
                    "h-9 w-9 shrink-0 rounded-xl border flex items-center justify-center text-sm font-semibold",
                    isMe ? "bg-black text-white border-black" : "bg-white border-zinc-900/10",
                  ].join(" ")}
                >
                  {i + 1}
                </div>

                <div className="min-w-0">
                  <div className="truncate font-semibold">
                    {mask(r.wallet)}
                    {isMe ? (
                      <span className="ml-2 rounded-full border border-zinc-900/15 bg-white px-2 py-0.5 text-xs font-medium">
                        You
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-600">
                    Verified missions: {r.completed}
                  </div>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold">{r.points} pts</div>
                <div className="text-xs text-zinc-600">{r.completed} done</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
