"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMission } from "@/lib/mission/store";
import type { Mission } from "@/lib/mission/types";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, type Transaction } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";

// -------------------- utils --------------------
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

function BigPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-zinc-900/10 bg-white/70 p-6">
      <div className="text-xs font-medium tracking-wide text-zinc-600">{title}</div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

// -------------------- types --------------------
type MinimalAnchorWallet = {
  publicKey: PublicKey;
  signTransaction(tx: Transaction): Promise<Transaction>;
  signAllTransactions?(txs: Transaction[]): Promise<Transaction[]>;
};

type OnchainState = {
  loading: boolean;
  exists: boolean | null;
  pda?: string;
  programId?: string; // points program
  owner?: string;
  total?: string;
  error?: string;
  tx?: string;
};

// ==================== Page ====================
export default function ProfilePage() {
  const {
    walletAddress,
    connecting,
    connectWallet,
    disconnectWallet,
    points,
    completedCount,
    missions,
  } = useMission();

  const safeMissions = useMemo(() => (missions ?? []) as Mission[], [missions]);

  const completedMissions = useMemo(() => {
    return safeMissions.filter(
      (m: any) => m?.status === "completed" || m?.completed === true
    );
  }, [safeMissions]);

  const badges = useMemo(() => {
    const pts = points ?? 0;
    const out: string[] = [];
    if (pts >= 500) out.push("OG");
    if (pts >= 1000) out.push("Early Access");
    if (pts >= 2000) out.push("Genesis Eligible");
    return out;
  }, [points]);

  // -------------------- wallet adapter --------------------
  const { connection } = useConnection();
  console.log("rpcEndpoint:", (connection as any)?.rpcEndpoint);

  const { publicKey, signTransaction, signAllTransactions } = useWallet();

  const anchorWallet = useMemo<MinimalAnchorWallet | null>(() => {
    if (!publicKey || !signTransaction) return null;
    return {
      publicKey,
      signTransaction: signTransaction as any,
      signAllTransactions: signAllTransactions as any,
    };
  }, [publicKey, signTransaction, signAllTransactions]);

  // -------------------- on-chain status --------------------
  const [onchain, setOnchain] = useState<OnchainState>({
    loading: false,
    exists: null,
  });

  const fetchOnchain = useCallback(async (wallet: string) => {
    const r = await fetch(`/api/points/onchain?wallet=${encodeURIComponent(wallet)}`, {
      cache: "no-store",
    });
    const j = await r.json();
    if (!j?.ok) throw new Error(j?.error || "onchain status error");

    return {
      exists: !!j.exists,
      pda: String(j.pda || ""),
      programId: String(j.programId || ""),
      owner: String(j.owner || ""),
      total: String(j.total ?? j.raw?.total_points ?? "0"),
    };
  }, []);

  const refreshOnchain = useCallback(async () => {
    if (!walletAddress) return;
    setOnchain((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const x = await fetchOnchain(walletAddress);
      setOnchain({
        loading: false,
        exists: x.exists,
        pda: x.pda,
        programId: x.programId,
        owner: x.owner,
        total: x.total,
      });
    } catch (e: any) {
      setOnchain((s) => ({
        ...s,
        loading: false,
        error: e?.message || String(e),
      }));
    }
  }, [walletAddress, fetchOnchain]);

  useEffect(() => {
    if (!walletAddress) {
      setOnchain({ loading: false, exists: null });
      return;
    }
    refreshOnchain();
  }, [walletAddress, refreshOnchain]);

  // -------------------- initialize on-chain --------------------
  const initializeOnchain = useCallback(async () => {
    try {
      if (!walletAddress) throw new Error("Wallet not connected");
      if (!anchorWallet) throw new Error("Wallet adapter not ready");

      const programIdStr = String(onchain.programId || "").trim();
      if (!programIdStr) throw new Error("Missing programId");
      const pdaStr = String(onchain.pda || "").trim();
      if (!pdaStr) throw new Error("Missing PDA");

      setOnchain((s) => ({ ...s, loading: true, error: undefined, tx: undefined }));

      const provider = new AnchorProvider(connection, anchorWallet as any, {
        commitment: "confirmed",
      });

      const program = await (Program as any).at(new PublicKey(programIdStr), provider);

      const sig = await program.methods
        .initializePoints()
        .accounts({
          user: anchorWallet.publicKey,
          points: new PublicKey(pdaStr),
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await refreshOnchain();
      setOnchain((s) => ({ ...s, tx: sig }));
    } catch (e: any) {
      setOnchain((s) => ({ ...s, loading: false, error: e?.message || String(e) }));
    }
  }, [walletAddress, anchorWallet, connection, onchain.programId, onchain.pda, refreshOnchain]);

  // ==================== render ====================
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl border border-zinc-900/10 bg-white/70 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-medium tracking-wide text-zinc-600">PROFILE</div>
            <h2 className="text-xl md:text-2xl font-semibold text-zinc-900">
              Your identity, reputation & progress
            </h2>
            <p className="text-sm text-zinc-700">
              Wallet-based profile. Missions are verified and points are written on-chain by the system/admin.
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-2">
              {!walletAddress ? (
                <button
                  onClick={connectWallet}
                  disabled={connecting}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
                >
                  {connecting ? "Connecting..." : "Connect Wallet"}
                </button>
              ) : (
                <button
                  onClick={disconnectWallet}
                  className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm"
                >
                  Disconnect
                </button>
              )}

              <Link href="/mission/missions" className="rounded-xl border px-4 py-2 text-sm">
                Go to Missions
              </Link>
              <Link href="/mission/rewards" className="rounded-xl border px-4 py-2 text-sm">
                View Rewards
              </Link>
            </div>

            {badges.length > 0 ? (
              <div className="pt-2 flex flex-wrap gap-2">
                {badges.map((b) => (
                  <span
                    key={b}
                    className="rounded-full border border-zinc-900/10 bg-white/60 px-3 py-1 text-xs text-zinc-700"
                  >
                    {b}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 md:w-[420px]">
            <StatCard label="Current Wallet" value={walletAddress ? mask(walletAddress) : "—"} />
            <StatCard label="Completed" value={completedCount} />
            <StatCard label="Local Points" value={walletAddress ? points : "—"} sub="UI cache / off-chain" />
            <StatCard label="Rank" value="—" />
          </div>
        </div>
      </div>

      {/* ON-CHAIN IDENTITY */}
      <BigPanel title="ON-CHAIN IDENTITY">
        {!walletAddress ? (
          <div className="text-sm text-zinc-700">Connect wallet to check your on-chain identity.</div>
        ) : onchain.loading ? (
          <div className="text-sm text-zinc-600">Checking / processing…</div>
        ) : onchain.exists === true ? (
          <div className="space-y-3">
            <div className="text-sm text-zinc-700">🟢 Initialized. Your points identity is on-chain.</div>

            <div className="text-xs font-mono text-zinc-600 break-all">pda: {onchain.pda}</div>
            <div className="text-xs font-mono text-zinc-600 break-all">pointsProgram: {onchain.programId}</div>
            <div className="text-xs font-mono text-zinc-600 break-all">owner: {onchain.owner}</div>

            <div className="rounded-2xl border border-zinc-900/10 bg-white/60 p-4">
              <div className="text-xs text-zinc-600">On-chain Total Points</div>
              <div className="mt-1 text-2xl font-semibold text-zinc-900">{onchain.total ?? "0"}</div>
              <div className="mt-1 text-xs text-zinc-600">
                Points are written by the system/admin when missions are verified.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={refreshOnchain}
                className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm"
              >
                Refresh On-chain Status
              </button>
            </div>

            {onchain.tx ? (
              <div className="text-xs text-zinc-600">
                last init tx: <span className="font-mono break-all">{onchain.tx}</span>
              </div>
            ) : null}

            {onchain.error ? <div className="text-xs text-red-600">{onchain.error}</div> : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-zinc-700">Not initialized yet.</div>
            <button
              onClick={initializeOnchain}
              disabled={!anchorWallet}
              className="rounded-xl bg-black px-6 py-3 text-sm font-semibold text-white"
            >
              Initialize On-chain Points
            </button>
            <button
              onClick={refreshOnchain}
              className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm"
            >
              Refresh
            </button>
            {onchain.error ? <div className="text-xs text-red-600">{onchain.error}</div> : null}
          </div>
        )}
      </BigPanel>

      {/* Progress */}
      <BigPanel title="PROGRESS">
        <div className="text-sm text-zinc-700">
          Completed {completedCount}/{safeMissions.length}
        </div>
      </BigPanel>

      {/* Recent Missions */}
      <BigPanel title="RECENT MISSIONS">
        {completedMissions.slice(0, 6).map((m: any) => (
          <div key={m.id} className="flex justify-between text-sm">
            <span>{m.title}</span>
            <span>+{m.basePoints ?? m.points ?? 0}</span>
          </div>
        ))}
      </BigPanel>
    </div>
  );
}
