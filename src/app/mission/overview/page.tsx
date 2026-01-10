"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { mockMissions } from "@/lib/mission/mock";

type Mission = {
  id: string;
  title: string;
  description?: string;
  category?: string;
  points?: number;
  completed?: boolean;
};

type StatsResp = {
  ok: boolean;
  wallet: string;
  driver: "memory" | "kv";
  period: { today: string; week: string };
  points: { today: number; week: number; all: number };
  completed: { all: number };
  streak: { count: number; lastDate: string; active: boolean };
};

type LedgerItem = {
  ts?: number;
  wallet?: string;
  missionId?: string;
  period?: "once" | "daily" | "weekly";
  periodKey?: string;
  amount?: number;
  reason?: string;
  raw?: string;
};

type HistoryResp = {
  ok: boolean;
  wallet: string;
  items: LedgerItem[];
};

type LeaderboardResp = {
  ok: boolean;
  participants: number;
};

const PRIZE_POOL_WAOC = 5_000_000;
const EVENT_STATUS: "LIVE" | "UPCOMING" | "ENDED" = "LIVE";
const RESET_RULE = "Daily reset at 00:00 UTC";
const VERIFICATION_NOTE =
  "Verification is wallet-based / on-chain where applicable. No private keys required.";

const PRIMARY_CTA_HREF = "/mission/missions";
const SECONDARY_CTA_HREF = "/mission/rewards";

// ✅ 你可以随时调整这三个长期任务的分数
const DAILY_CHECKIN_POINTS = 20;
const DAILY_SHARE_POINTS = 10;
const WEEKLY_VOTE_POINTS = 50;

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border bg-white px-3 py-1 text-xs font-medium">
      {children}
    </span>
  );
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
    <div className="rounded-2xl border bg-white p-5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub ? <div className="mt-2 text-sm text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  desc,
}: {
  eyebrow?: string;
  title: string;
  desc?: string;
}) {
  return (
    <div className="space-y-2">
      {eyebrow ? (
        <div className="text-xs font-medium tracking-wide text-muted-foreground">
          {eyebrow}
        </div>
      ) : null}
      <h2 className="text-xl md:text-2xl font-semibold">{title}</h2>
      {desc ? <p className="text-sm md:text-base text-muted-foreground">{desc}</p> : null}
    </div>
  );
}

function Pill({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-3 py-1 text-xs border",
        active ? "bg-black text-white border-black" : "bg-white",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function fmtNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

function shortWallet(w: string) {
  if (!w) return "";
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

function timeAgo(ts?: number) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default function MissionOverviewPage() {
  const { publicKey, connected } = useWallet();
  const wallet = useMemo(() => publicKey?.toBase58?.() ?? "", [publicKey]);

  const featured = useMemo(() => {
    const list = (mockMissions as Mission[]) || [];
    return [...list].sort((a, b) => (b.points ?? 0) - (a.points ?? 0)).slice(0, 6);
  }, []);

  const statusLabel =
    EVENT_STATUS === "LIVE" ? "Live Now" : EVENT_STATUS === "UPCOMING" ? "Starting Soon" : "Ended";

  const statusTone =
    EVENT_STATUS === "LIVE"
      ? "bg-green-50 border-green-200 text-green-700"
      : EVENT_STATUS === "UPCOMING"
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-muted/30 border-muted text-muted-foreground";

  const [stats, setStats] = useState<StatsResp | null>(null);
  const [history, setHistory] = useState<LedgerItem[]>([]);
  const [participants, setParticipants] = useState<number | null>(null);

  const [busy, setBusy] = useState<null | "checkin" | "share" | "vote">(null);
  const [msg, setMsg] = useState<string>("");

  async function refreshAll(w: string) {
    if (!w) return;

    // stats
    const sRes = await fetch(`/api/mission/stats?wallet=${encodeURIComponent(w)}`, {
      cache: "no-store",
    });
    const sJson = await safeJson<StatsResp>(sRes);
    if (sJson?.ok) setStats(sJson);

    // history (ledger)
    const hRes = await fetch(`/api/mission/history?wallet=${encodeURIComponent(w)}&limit=20`, {
      cache: "no-store",
    });
    const hJson = await safeJson<HistoryResp>(hRes);
    if (hJson?.ok) setHistory(Array.isArray(hJson.items) ? hJson.items : []);

    // participants from leaderboard (all-time points)
    const pRes = await fetch(`/api/leaderboard?period=all&sort=points&order=desc&limit=1`, {
      cache: "no-store",
    });
    const pJson = await safeJson<LeaderboardResp>(pRes);
    if (pJson?.ok && typeof pJson.participants === "number") setParticipants(pJson.participants);
  }

  useEffect(() => {
    setMsg("");
    setStats(null);
    setHistory([]);
    if (!wallet) return;
    refreshAll(wallet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  async function claim(missionId: string, points: number, tag: "checkin" | "share" | "vote") {
    if (!wallet) {
      setMsg("Connect your wallet first.");
      return;
    }
    setMsg("");
    setBusy(tag);
    try {
      const res = await fetch("/api/mission/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          missionId,
          wallet,
          points,
        }),
      });

      const json = await safeJson<any>(res);

      if (!res.ok || !json?.ok) {
        setMsg(json?.error ? `Error: ${json.error}` : "Request failed.");
        return;
      }

      if (json?.alreadyVerified) {
        setMsg("Already claimed for this period ✅");
      } else {
        setMsg(`+${points} points ✅`);
      }

      await refreshAll(wallet);
    } catch (e: any) {
      setMsg(e?.message ? `Error: ${e.message}` : "Error");
    } finally {
      setBusy(null);
    }
  }

  const yourStatus = connected ? "Connected" : "Not connected";

  return (
    <div className="space-y-10">
      {/* =================== HERO =================== */}
      <div className="rounded-3xl border bg-white p-6 md:p-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-4 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs ${statusTone}`}>
                {statusLabel}
              </span>
              <Badge>One Mission</Badge>
              <Badge>WAOC Ecosystem</Badge>
              <Badge>Daily · Weekly · Streak</Badge>
            </div>

            <h1 className="text-2xl md:text-4xl font-semibold leading-tight">
              Long-term missions. Continuous points. Real reputation.
            </h1>

            <p className="text-sm md:text-base text-muted-foreground">
              Use the <b>same wallet</b> to build a long-term contribution record. Daily/weekly missions
              reset by period, points accumulate forever, and streak rewards consistency.
            </p>

            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href={PRIMARY_CTA_HREF}
                className="inline-flex items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-medium text-white hover:opacity-90"
              >
                Open Missions
              </Link>
              <Link
                href={SECONDARY_CTA_HREF}
                className="inline-flex items-center justify-center rounded-xl border px-5 py-3 text-sm font-medium hover:bg-muted"
              >
                View Rewards
              </Link>
              <Link
                href="/mission/leaderboard"
                className="inline-flex items-center justify-center rounded-xl border px-5 py-3 text-sm font-medium hover:bg-muted"
              >
                Leaderboard
              </Link>
            </div>

            <div className="text-xs text-muted-foreground pt-1">{VERIFICATION_NOTE}</div>

            {/* Quick actions */}
            <div className="rounded-2xl border bg-muted/10 p-4 mt-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Quick Actions</div>
                  <div className="text-xs text-muted-foreground">
                    Claim daily/weekly points with this wallet. (Period-based anti-duplicate)
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => claim("daily:checkin", DAILY_CHECKIN_POINTS, "checkin")}
                    disabled={!wallet || busy !== null}
                    className="inline-flex items-center justify-center rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {busy === "checkin" ? "Claiming…" : `Daily Check-in +${DAILY_CHECKIN_POINTS}`}
                  </button>

                  <button
                    onClick={() => claim("daily:share", DAILY_SHARE_POINTS, "share")}
                    disabled={!wallet || busy !== null}
                    className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                  >
                    {busy === "share" ? "Claiming…" : `Daily Share +${DAILY_SHARE_POINTS}`}
                  </button>

                  <button
                    onClick={() => claim("weekly:vote", WEEKLY_VOTE_POINTS, "vote")}
                    disabled={!wallet || busy !== null}
                    className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                  >
                    {busy === "vote" ? "Claiming…" : `Weekly Vote +${WEEKLY_VOTE_POINTS}`}
                  </button>
                </div>
              </div>

              {msg ? (
                <div className="mt-3 text-sm">
                  <span className="rounded-lg border bg-white px-3 py-2 inline-block">{msg}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Right panel */}
          <div className="w-full md:w-[360px] space-y-3">
            <div className="rounded-2xl border bg-muted/20 p-5">
              <div className="text-xs text-muted-foreground">Prize Pool</div>
              <div className="mt-1 text-2xl font-semibold">{fmtNumber(PRIZE_POOL_WAOC)} WAOC</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Distributed by points & milestones.
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-5 space-y-2">
              <div className="text-xs text-muted-foreground">Reset Rule</div>
              <div className="text-sm font-medium">{RESET_RULE}</div>
              <div className="text-xs text-muted-foreground">
                Daily/Weekly missions are period-based. Your total points never reset.
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-5 space-y-2">
              <div className="text-xs text-muted-foreground">Wallet</div>
              <div className="text-sm">
                Status: <b>{yourStatus}</b>
              </div>
              <div className="text-xs text-muted-foreground">
                {wallet ? `Address: ${shortWallet(wallet)}` : "Connect wallet to start earning."}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =================== STATS (REAL) =================== */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Participants"
          value={participants == null ? "—" : fmtNumber(participants)}
          sub="Based on leaderboard records."
        />
        <StatCard
          label="Your Total Points"
          value={stats ? fmtNumber(stats.points.all) : "—"}
          sub={wallet ? "Accumulates forever." : "Connect wallet to join."}
        />
        <StatCard
          label="Today / This Week"
          value={
            stats ? (
              <span>
                {fmtNumber(stats.points.today)} / {fmtNumber(stats.points.week)}
              </span>
            ) : (
              "—"
            )
          }
          sub="Period-based points."
        />
        <StatCard
          label="Streak"
          value={stats ? fmtNumber(stats.streak.count) : "—"}
          sub={
            stats
              ? stats.streak.active
                ? "Active today ✅"
                : "Not active today"
              : "Complete a daily mission to build streak."
          }
        />
      </div>

      {/* =================== LEDGER (RECENT POINTS) =================== */}
      <div className="rounded-2xl border bg-white p-6">
        <SectionTitle
          eyebrow="ACTIVITY"
          title="Recent points history"
          desc="This is your points ledger (auditable record)."
        />

        <div className="mt-5">
          {!wallet ? (
            <div className="text-sm text-muted-foreground">Connect your wallet to see history.</div>
          ) : history.length === 0 ? (
            <div className="text-sm text-muted-foreground">No records yet. Claim a mission above.</div>
          ) : (
            <div className="space-y-2">
              {history.slice(0, 10).map((it, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-xl border bg-muted/10 p-4"
                >
                  <div className="space-y-1">
                    <div className="text-sm font-medium">
                      {it.missionId ?? "record"}{" "}
                      <span className="text-xs text-muted-foreground">
                        {it.period ? `· ${it.period}` : ""}
                        {it.periodKey ? ` · ${it.periodKey}` : ""}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {timeAgo(it.ts)} {it.reason ? `· ${it.reason}` : ""}
                    </div>
                  </div>
                  <div className="text-sm font-semibold">
                    {typeof it.amount === "number" ? `+${fmtNumber(it.amount)}` : "—"}
                  </div>
                </div>
              ))}

              <div className="pt-2">
                <Link
                  href="/mission/rewards"
                  className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  View rewards details →
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* =================== HOW IT WORKS =================== */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border bg-white p-6">
          <SectionTitle
            eyebrow="HOW IT WORKS"
            title="Long-term loop (not one-time)"
            desc="Daily / Weekly resets keep the system alive. Ledger keeps it fair."
          />
          <div className="mt-5 space-y-3 text-sm">
            {[
              { k: "1", t: "Use one wallet", d: "Same wallet = consistent identity & reputation." },
              { k: "2", t: "Claim daily/weekly missions", d: "Missions reset by periodKey (daily/weekly)." },
              { k: "3", t: "Points ledger records everything", d: "Every points change is recorded and auditable." },
              { k: "4", t: "Streak rewards consistency", d: "Daily missions build streak to encourage retention." },
            ].map((x) => (
              <div key={x.k} className="flex gap-3 rounded-xl border bg-muted/10 p-4">
                <div className="h-7 w-7 shrink-0 rounded-lg border bg-white flex items-center justify-center text-xs font-semibold">
                  {x.k}
                </div>
                <div>
                  <div className="font-medium">{x.t}</div>
                  <div className="text-muted-foreground">{x.d}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Pill active>Ledger-based</Pill>
            <Pill>Daily/Weekly</Pill>
            <Pill>Streak</Pill>
            <Pill>Anti-duplicate</Pill>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-6">
          <SectionTitle
            eyebrow="REWARDS"
            title="Prize pool distribution"
            desc="Keep thresholds clear; details inside Rewards page."
          />

          <div className="mt-5 space-y-3 text-sm">
            {[
              { t: "Tier 1", p: "≥ 200 pts", d: "Starter perks / community role" },
              { t: "Tier 2", p: "≥ 600 pts", d: "Early access / whitelist eligibility" },
              { t: "Tier 3", p: "≥ 1200 pts", d: "Bonus rewards / priority drops" },
              { t: "Tier 4", p: "≥ 2000 pts", d: "Top contributor pool / special rewards" },
            ].map((r) => (
              <div key={r.t} className="rounded-xl border bg-muted/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{r.t}</div>
                  <Badge>{r.p}</Badge>
                </div>
                <div className="mt-2 text-muted-foreground">{r.d}</div>
              </div>
            ))}
          </div>

          <div className="mt-5">
            <Link
              href={SECONDARY_CTA_HREF}
              className="inline-flex items-center justify-center rounded-xl border px-5 py-3 text-sm font-medium hover:bg-muted"
            >
              See full Rewards details
            </Link>
          </div>
        </div>
      </div>

      {/* =================== FEATURED MISSIONS (PREVIEW) =================== */}
      <div className="rounded-2xl border bg-white p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <SectionTitle
            eyebrow="FEATURED"
            title="Featured missions (preview)"
            desc="Preview only. Go to Missions page to execute & verify."
          />
          <Link
            href={PRIMARY_CTA_HREF}
            className="inline-flex items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-medium text-white hover:opacity-90"
          >
            Go to Missions →
          </Link>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {featured.map((m) => (
            <div key={m.id} className="rounded-2xl border bg-muted/10 p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-semibold">{m.title}</div>
                  {m.description ? (
                    <div className="text-sm text-muted-foreground">{m.description}</div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Complete this mission to earn points.
                    </div>
                  )}
                </div>
                <Badge>{(m.points ?? 0) > 0 ? `+${m.points} pts` : "Points"}</Badge>
              </div>

              <div className="flex flex-wrap gap-2">
                <Pill>{m.category ?? "General"}</Pill>
                {m.completed ? <Pill active>Completed</Pill> : <Pill>Not done</Pill>}
              </div>

              <div className="pt-1">
                <Link
                  href={PRIMARY_CTA_HREF}
                  className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Open in Missions
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* =================== FAQ =================== */}
      <div className="rounded-2xl border bg-white p-6">
        <SectionTitle eyebrow="FAQ" title="Common questions" desc="Short answers here; details later in Docs." />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {[
            {
              q: "Do points reset?",
              a: "Your total points never reset. Only daily/weekly points reset by period.",
            },
            {
              q: "How is duplicate prevented?",
              a: "Claims are stored by periodKey (daily/weekly) so repeated clicks won’t add points again.",
            },
            {
              q: "Is it on-chain?",
              a: "Some missions can be verified on-chain (SOL/SPL/NFT). Others are wallet-based proofs.",
            },
            {
              q: "Where do I execute missions?",
              a: "Go to the Missions page for the full mission list and verification steps.",
            },
          ].map((x) => (
            <div key={x.q} className="rounded-2xl border bg-muted/10 p-5">
              <div className="font-medium">{x.q}</div>
              <div className="mt-2 text-sm text-muted-foreground">{x.a}</div>
            </div>
          ))}
        </div>
      </div>

      {/* =================== FINAL CTA =================== */}
      <div className="rounded-3xl border bg-white p-6 md:p-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">Ready to participate?</div>
          <div className="text-xl md:text-2xl font-semibold">
            Keep your streak. Grow your score. Climb weekly leaderboard.
          </div>
        </div>
        <div className="flex gap-3">
          <Link
            href={PRIMARY_CTA_HREF}
            className="inline-flex items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-medium text-white hover:opacity-90"
          >
            Open Missions
          </Link>
          <Link
            href="/mission/leaderboard"
            className="inline-flex items-center justify-center rounded-xl border px-5 py-3 text-sm font-medium hover:bg-muted"
          >
            Leaderboard
          </Link>
        </div>
      </div>
    </div>
  );
}
