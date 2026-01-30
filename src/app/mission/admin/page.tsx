"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";

type PendingItem = {
  ts?: number;
  wallet?: string;
  missionId?: string;
  period?: "once" | "daily" | "weekly";
  periodKey?: string;

  proof?: any;
  note?: string;
  proofUrl?: string;
  files?: Array<{ name?: string; type?: string; size?: number; dataUrl?: string; url?: string }>;

  // ✅ 必须由后端生成并写入 pending
  submissionId?: string;

  raw?: any;
};

function fmtTime(ts?: number) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function clamp(n: number, min: number, max: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function shortWallet(w?: string) {
  if (!w) return "";
  if (w.length <= 10) return w;
  return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

async function copyToClipboard(s: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(s);
      return;
    }
  } catch {}
  try {
    const el = document.createElement("textarea");
    el.value = s;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  } catch {}
}

function normalizeWalletSignError(e: any) {
  const raw = String(e?.message || e || "");
  const m = raw.toLowerCase();

  if (m.includes("walletsignmessageerror") && m.includes("invalid account")) {
    return "Wallet signature failed: invalid account. Please disconnect the wallet, refresh the page, then reconnect (do not switch account), and try again.";
  }
  if (m.includes("user rejected") || m.includes("rejected")) {
    return "Signature request was rejected in wallet.";
  }
  if (m.includes("not connected") || m.includes("wallet not connected")) {
    return "Wallet not connected. Please connect your admin wallet first.";
  }
  if (m.includes("signmessage") && m.includes("not supported")) {
    return "This wallet does not support signMessage. Use Phantom / Backpack / Solflare (with message signing enabled).";
  }
  return raw || "Admin request failed";
}

function isHttpUrl(s: string) {
  return /^https?:\/\//i.test(s);
}

function safeUrl(v: any): string {
  if (!v) return "";
  if (typeof v === "function") return "";
  const s = String(v).trim();
  if (!s) return "";
  if (s.startsWith("function ")) return "";
  if (s === "[object Object]") return "";
  return s;
}

function extractProof(it: PendingItem) {
  const p = it.proof ?? {};

  const urlCandidate =
    safeUrl(it.proofUrl) ||
    safeUrl(p.url) ||
    safeUrl(p.link) ||
    safeUrl(p.proofUrl) ||
    (typeof p === "string" && isHttpUrl(p) ? p : "");

  const url = isHttpUrl(urlCandidate) ? urlCandidate : "";

  const text = String((p as any).text || (p as any).note || (p as any).desc || it.note || "").trim();
  const tx = String((p as any).tx || (p as any).signature || (p as any).hash || "").trim();

  const filesRaw: any[] = Array.isArray(it.files)
    ? it.files
    : Array.isArray((p as any).files)
    ? (p as any).files
    : Array.isArray((p as any).images)
    ? (p as any).images
    : [];

  const images = filesRaw
    .map((f) => ({
      name: String(f?.name || ""),
      url: safeUrl(f?.dataUrl || f?.url || ""),
      type: String(f?.type || ""),
      size: Number(f?.size || 0) || 0,
    }))
    .filter((x) => x.url);

  return { url, text, tx, images, raw: it.proof };
}

// ✅ 只用于“登录/登出/检查 session”的签名头（不再给 pending/approve/reject 用）
async function adminHeadersForSession(
  walletAddress: string,
  signMessage: any,
  method: "GET" | "POST" | "DELETE",
  path: "/api/mission/admin/session"
) {
  const ts = String(Date.now());
  if (!walletAddress) throw new Error("Wallet not connected.");
  if (!signMessage) throw new Error("Wallet does not support signMessage.");

  // ✅ 关键：msg 第一段必须是 METHOD:/api/xxx（不能带 query）
  const msg = `${method}:${path}`;
  const payload = `${msg}|${ts}`;
  const data = new TextEncoder().encode(payload);
  const sigBytes = await signMessage(data);
  const sig = bs58.encode(sigBytes);

  return {
    "x-admin-wallet": walletAddress,
    "x-admin-timestamp": ts,
    "x-admin-msg": msg,
    "x-admin-signature": sig,
  };
}

export default function AdminPage() {
  const { publicKey, connected, signMessage, wallet } = useWallet();
  const walletAddress = useMemo(() => (publicKey ? publicKey.toBase58() : ""), [publicKey]);
  const canSign = Boolean(signMessage);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [err, setErr] = useState<string>("");

  const [limit, setLimit] = useState(50);

  // ✅ 这里 adminSession 代表“服务端 session 是否有效”（cookie）
  const [adminSession, setAdminSession] = useState<{ ok: boolean; wallet?: string }>({ ok: false });
  const adminWallet = adminSession.ok ? adminSession.wallet || "" : "";

  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  const [lightbox, setLightbox] = useState<{ open: boolean; src?: string; title?: string }>({
    open: false,
  });

  // ✅ 只用于 list/pending 拉取的取消（不要拿它去 abort approve/reject）
  const pendingAbortRef = useRef<AbortController | null>(null);
  const pendingActionLock = useRef<Set<string>>(new Set());

  async function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
    const r = await fetch(input, init);
    const j = await r.json().catch(() => ({}));
    return { r, j };
  }

  // ✅ 永远以服务端 session 为准（避免“UI显示已登录但请求401”）
  const checkAdminSession = async () => {
    try {
      const { r, j } = await fetchJson("/api/mission/admin/session", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      if (r.ok && j?.ok) setAdminSession({ ok: true, wallet: j.wallet });
      else setAdminSession({ ok: false });
    } catch {
      setAdminSession({ ok: false });
    }
  };

  const adminLogin = async () => {
    setErr("");
    if (!connected || !walletAddress) return setErr("Connect admin wallet first.");
    if (!canSign) return setErr("Wallet must support signMessage (e.g., Phantom).");

    if (!publicKey) return setErr("Wallet not connected.");
    if (walletAddress !== publicKey.toBase58()) {
      return setErr("Wallet state mismatch. Please disconnect and reconnect your wallet.");
    }

    setLoading(true);
    try {
      // ✅ 只签一次：POST /api/mission/admin/session
      const headers = await adminHeadersForSession(walletAddress, signMessage, "POST", "/api/mission/admin/session");

      const { r, j } = await fetchJson("/api/mission/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        cache: "no-store",
        credentials: "include", // ✅ 关键：让后端 set-cookie 生效
        body: JSON.stringify({}),
      });

      if (!r.ok || !j?.ok) {
        return setErr(j?.error || `Admin login failed (${r.status})`);
      }

      // ✅ 立刻同步 session
      await checkAdminSession();
    } catch (e: any) {
      setErr(normalizeWalletSignError(e));
    } finally {
      setLoading(false);
    }
  };

  const adminLogout = async () => {
    setErr("");
    setLoading(true);
    try {
      // ✅ 可选：DELETE session（这里也签一下，保持一致）
      if (connected && walletAddress && canSign) {
        try {
          const headers = await adminHeadersForSession(
            walletAddress,
            signMessage,
            "DELETE",
            "/api/mission/admin/session"
          );
          await fetch("/api/mission/admin/session", {
            method: "DELETE",
            headers,
            cache: "no-store",
            credentials: "include",
          }).catch(() => {});
        } catch {
          // ignore
        }
      }
    } finally {
      setAdminSession({ ok: false });
      setItems([]);
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAdminSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Load Pending：不签名，不弹窗，只带 cookie
  const loadPending = async () => {
    setErr("");
    if (!adminSession.ok) return setErr("Admin session required. Click Admin Login first.");

    pendingAbortRef.current?.abort();
    const ac = new AbortController();
    pendingAbortRef.current = ac;

    setLoading(true);
    try {
      const lim = clamp(limit, 1, 1000);
      const url = `/api/mission/pending?limit=${lim}&slim=1`;

      const r = await fetch(url, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        signal: ac.signal,
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        // ✅ session 失效则同步 UI
        if (r.status === 401) await checkAdminSession();
        return setErr(j?.error || `Request failed (${r.status})`);
      }

      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e: any) {
      if (String(e?.name || "").toLowerCase().includes("abort")) return;
      setErr(e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  };

  const removeLocal = (sid: string) => {
    setItems((prev) => prev.filter((x) => x.submissionId !== sid));
  };

  // ✅ Approve：不签名，不弹窗，只带 cookie
  const approveOne = async (it: PendingItem) => {
    setErr("");
    if (!adminSession.ok) return setErr("Admin session required. Click Admin Login first.");
    if (!it.submissionId) return setErr("Missing submissionId. Backend must generate submissionId.");

    const sid = it.submissionId;

    if (pendingActionLock.current.has(sid)) return;
    pendingActionLock.current.add(sid);

    const snapshot = items;
    removeLocal(sid);

    setLoading(true);
    try {
      const body = { submissionId: sid, note: "approved_by_admin" };

      const r = await fetch(`/api/mission/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include",
        body: JSON.stringify(body),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setItems(snapshot);
        if (r.status === 401) await checkAdminSession();
        return setErr(j?.error || `Approve failed (${r.status})`);
      }
    } catch (e: any) {
      setItems(snapshot);
      setErr(e?.message || "Approve failed");
    } finally {
      pendingActionLock.current.delete(sid);
      setLoading(false);
    }
  };

  // ✅ Reject：不签名，不弹窗，只带 cookie
  const rejectOne = async (it: PendingItem) => {
    setErr("");
    if (!adminSession.ok) return setErr("Admin session required. Click Admin Login first.");
    if (!it.submissionId) return setErr("Missing submissionId. Backend must generate submissionId.");

    const sid = it.submissionId;

    if (pendingActionLock.current.has(sid)) return;
    pendingActionLock.current.add(sid);

    const snapshot = items;
    const reason = (rejectReason[sid] || "").trim() || "not_enough_proof";

    removeLocal(sid);

    setLoading(true);
    try {
      const body = { submissionId: sid, reason, note: "" };

      const r = await fetch(`/api/mission/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include",
        body: JSON.stringify(body),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setItems(snapshot);
        if (r.status === 401) await checkAdminSession();
        return setErr(j?.error || `Reject failed (${r.status})`);
      }
    } catch (e: any) {
      setItems(snapshot);
      setErr(e?.message || "Reject failed");
    } finally {
      pendingActionLock.current.delete(sid);
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Lightbox */}
      {lightbox.open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setLightbox({ open: false })}
          />
          <div className="relative w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-black/70 shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 text-sm text-white/90">
              <div className="truncate">{lightbox.title || "Screenshot"}</div>
              <button
                className="rounded-xl bg-white/10 px-3 py-1.5 hover:bg-white/15"
                onClick={() => setLightbox({ open: false })}
              >
                Close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.src}
              alt={lightbox.title || "proof"}
              className="max-h-[80vh] w-full object-contain"
            />
          </div>
        </div>
      ) : null}

      {/* Header */}
      <div className="rounded-3xl border border-zinc-900/10 bg-white/70 p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs text-zinc-600">ONE MISSION</div>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-900">Admin Review</h1>
            <p className="mt-1 text-sm text-zinc-700">
              Review pending submissions. ✅ Requires <b>submissionId</b> from backend for correct approve/reject removal.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/mission/missions"
              className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
            >
              Back to Missions
            </Link>

            <button
              type="button"
              onClick={loadPending}
              disabled={loading || !adminSession.ok}
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-60"
            >
              {loading ? "Loading..." : "Load Pending"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-700">Admin Session:</span>

          {adminSession.ok && adminWallet ? (
            <span className="rounded-full border border-zinc-900/10 bg-white px-3 py-1 font-semibold">
              {shortWallet(adminWallet)}
            </span>
          ) : (
            <span className="text-zinc-500">Not logged in</span>
          )}

          <button
            type="button"
            onClick={adminLogin}
            disabled={loading || !connected || !walletAddress || !canSign}
            className="rounded-xl border border-zinc-900/15 bg-white/60 px-3 py-2 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-60"
            title={
              !connected
                ? "Connect wallet first"
                : !canSign
                ? "Wallet must support signMessage"
                : wallet?.adapter?.name
                ? `Wallet: ${wallet.adapter.name}`
                : ""
            }
          >
            {adminSession.ok ? "Re-login" : "Admin Login"}
          </button>

          <button
            type="button"
            onClick={adminLogout}
            disabled={loading || !adminSession.ok}
            className="rounded-xl border border-zinc-900/15 bg-white/60 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-white disabled:opacity-60"
          >
            Logout
          </button>

          <button
            type="button"
            onClick={checkAdminSession}
            disabled={loading}
            className="rounded-xl border border-zinc-900/15 bg-white/60 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-white disabled:opacity-60"
            title="Re-check session from server"
          >
            Refresh Session
          </button>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-zinc-600 text-xs">Limit</span>
            <input
              value={limit}
              onChange={(e) => setLimit(clamp(Number(e.target.value || 50), 1, 1000))}
              className="w-28 rounded-xl border border-zinc-900/15 bg-white/70 px-3 py-2 text-sm"
              type="number"
              min={1}
              max={1000}
            />
          </div>
        </div>

        {!adminSession.ok ? (
          <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-50/60 p-3 text-sm text-amber-900">
            Admin is separate: connect your <b>admin wallet</b> and click <b>Admin Login</b>.
            <div className="mt-2 text-xs text-amber-900/80">
              If you see <b>invalid account</b>, disconnect wallet → refresh → reconnect (do not switch account).
            </div>
          </div>
        ) : null}

        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-50/60 p-3 text-sm text-rose-900">
            {err}
          </div>
        ) : null}
      </div>

      {/* List */}
      <div className="rounded-3xl border border-zinc-900/10 bg-white/70 p-4">
        <div className="flex items-center justify-between px-2 pb-3">
          <div className="text-sm text-zinc-700">
            Pending items: <b>{items.length}</b>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-zinc-900/10 bg-white/60 p-8 text-center">
            <div className="text-base font-semibold">No pending submissions</div>
            <div className="mt-2 text-sm text-zinc-600">
              {adminSession.ok ? (
                <>
                  Click <b>Load Pending</b> to fetch items.
                </>
              ) : (
                <>
                  Click <b>Admin Login</b> first.
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {items.map((it, idx) => {
              const pf = extractProof(it);
              const sid = it.submissionId || "";
              const hasSid = Boolean(sid);

              return (
                <div
                  key={(sid || `${it.wallet}|${it.missionId}|${it.periodKey || ""}`) + ":" + idx}
                  className="rounded-2xl border border-zinc-900/10 bg-white/60 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1 min-w-0">
                      <div className="text-sm font-semibold text-zinc-900">
                        {it.missionId || "unknown mission"}
                      </div>

                      {hasSid ? (
                        <div className="text-xs text-zinc-600">
                          Submission: <span className="font-mono">{sid}</span>
                        </div>
                      ) : (
                        <div className="mt-2 rounded-2xl border border-amber-500/20 bg-amber-50/60 p-3 text-sm text-amber-900">
                          ⚠️ Missing <b>submissionId</b>. Backend must generate it in pending queue, otherwise approve/reject cannot remove items.
                        </div>
                      )}

                      <div className="text-xs text-zinc-600 flex flex-wrap items-center gap-2">
                        <span>
                          Wallet: <span className="font-mono">{it.wallet}</span>
                        </span>
                        {it.wallet ? (
                          <button
                            className="rounded-lg border border-zinc-900/10 bg-white px-2 py-1 text-[11px] hover:bg-white/90"
                            onClick={() => copyToClipboard(it.wallet || "")}
                          >
                            Copy
                          </button>
                        ) : null}
                      </div>

                      <div className="text-xs text-zinc-600">
                        Period: <b>{it.period || "?"}</b>{" "}
                        {it.periodKey ? (
                          <>
                            · Key: <span className="font-mono">{it.periodKey}</span>
                          </>
                        ) : null}
                      </div>

                      <div className="text-xs text-zinc-600">
                        Time: <b>{fmtTime(it.ts)}</b>
                      </div>

                      {pf.url ? (
                        <div className="mt-3 rounded-2xl border border-zinc-900/10 bg-white/70 p-3">
                          <div className="text-xs font-semibold text-zinc-800">Proof link</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <a
                              href={pf.url}
                              target="_blank"
                              rel="noreferrer"
                              className="truncate text-sm text-blue-700 underline"
                              title={pf.url}
                            >
                              {pf.url}
                            </a>
                            <button
                              className="rounded-lg border border-zinc-900/10 bg-white px-2 py-1 text-[11px] hover:bg-white/90"
                              onClick={() => copyToClipboard(pf.url)}
                            >
                              Copy
                            </button>
                            <a
                              href={pf.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg bg-black px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-black/90"
                            >
                              Open
                            </a>
                          </div>
                        </div>
                      ) : null}

                      {pf.text ? (
                        <div className="mt-3 rounded-2xl border border-zinc-900/10 bg-white/70 p-3">
                          <div className="text-xs font-semibold text-zinc-800">Notes</div>
                          <div className="mt-1 text-sm text-zinc-700 whitespace-pre-wrap break-words">
                            {pf.text}
                          </div>
                        </div>
                      ) : null}

                      {pf.tx ? (
                        <div className="mt-3 rounded-2xl border border-zinc-900/10 bg-white/70 p-3">
                          <div className="text-xs font-semibold text-zinc-800">Tx / Signature</div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="font-mono text-[12px] text-zinc-700 truncate">{pf.tx}</span>
                            <button
                              className="rounded-lg border border-zinc-900/10 bg-white px-2 py-1 text-[11px] hover:bg-white/90"
                              onClick={() => copyToClipboard(pf.tx)}
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {pf.images.length ? (
                        <div className="mt-3 rounded-2xl border border-zinc-900/10 bg-white/70 p-3">
                          <div className="text-xs font-semibold text-zinc-800">Screenshots</div>
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            {pf.images.map((img, i) => (
                              <button
                                key={i}
                                className="group rounded-2xl border border-zinc-900/10 bg-white p-2 text-left hover:bg-white/90"
                                onClick={() =>
                                  setLightbox({ open: true, src: img.url, title: img.name || "Screenshot" })
                                }
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={img.url}
                                  alt={img.name || "proof"}
                                  className="h-24 w-full rounded-xl object-cover"
                                />
                                <div className="mt-2 truncate text-[11px] text-zinc-600">
                                  {img.name || "image"}{" "}
                                  {img.size ? (
                                    <span className="text-zinc-400">({Math.round(img.size / 1024)}KB)</span>
                                  ) : null}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex w-full flex-col gap-2 md:w-[320px]">
                      <button
                        type="button"
                        onClick={() => approveOne(it)}
                        disabled={loading || !adminSession.ok || !hasSid}
                        className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-60"
                      >
                        Approve
                      </button>

                      <input
                        value={rejectReason[sid] || ""}
                        onChange={(e) => setRejectReason((p) => ({ ...p, [sid]: e.target.value }))}
                        placeholder="Reject reason (optional)"
                        disabled={!hasSid}
                        className="rounded-xl border border-zinc-900/15 bg-white/70 px-3 py-2 text-sm disabled:opacity-60"
                      />

                      <button
                        type="button"
                        onClick={() => rejectOne(it)}
                        disabled={loading || !adminSession.ok || !hasSid}
                        className="rounded-xl border border-rose-500/30 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-900 hover:bg-rose-100 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
