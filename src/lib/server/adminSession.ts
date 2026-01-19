import crypto from "crypto";
import { getRedis } from "@/lib/server/redis";

type Driver = "memory" | "kv";
type MemDB = { kv: Map<string, any> };

function pickDriver(): Driver {
  const v = String(process.env.MISSION_STORE_DRIVER || "memory").toLowerCase();
  return v === "kv" ? "kv" : "memory";
}

function getMemDB(): MemDB {
  const g = globalThis as unknown as { __ONE_MISSION_MEMDB__?: MemDB };
  if (!g.__ONE_MISSION_MEMDB__) g.__ONE_MISSION_MEMDB__ = { kv: new Map() };
  return g.__ONE_MISSION_MEMDB__;
}

function parseAdminWallets(): string[] {
  const raw = String(process.env.MISSION_ADMIN_WALLETS || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function sessionTtlSec() {
  const v = Number(process.env.MISSION_ADMIN_SESSION_TTL_SEC || 1800); // 默认 30min
  return Number.isFinite(v) ? Math.max(60, Math.floor(v)) : 1800;
}

export const ADMIN_SESSION_COOKIE = "waoc_admin_session";
const SESSION_PREFIX = "admin:sess:";

function genToken() {
  return crypto.randomBytes(24).toString("hex"); // 48 chars
}

async function kvClient() {
  return getRedis();
}

export async function createAdminSession(adminWallet: string) {
  const admins = parseAdminWallets();
  if (!admins.includes(adminWallet)) return { ok: false as const, error: "not_admin" };

  const token = genToken();
  const ttl = sessionTtlSec();
  const key = `${SESSION_PREFIX}${token}`;
  const payload = { wallet: adminWallet, ts: Date.now() };

  const driver = pickDriver();
  if (driver === "kv") {
    const redis = await kvClient();
    await (redis as any).set(key, JSON.stringify(payload));
    await (redis as any).expire(key, ttl);
  } else {
    getMemDB().kv.set(key, payload);
    // memory driver 用 setTimeout 模拟过期（dev 足够）
    setTimeout(() => {
      try {
        getMemDB().kv.delete(key);
      } catch {}
    }, ttl * 1000);
  }

  return { ok: true as const, token, ttl, wallet: adminWallet };
}

export async function readAdminSession(token: string | null | undefined) {
  const t = String(token || "").trim();
  if (!t) return { ok: false as const, error: "no_session" };

  const key = `${SESSION_PREFIX}${t}`;
  const driver = pickDriver();

  if (driver === "kv") {
    const redis = await kvClient();
    const raw = await (redis as any).get(key);
    if (!raw) return { ok: false as const, error: "session_expired" };
    try {
      const parsed = JSON.parse(raw);
      return { ok: true as const, wallet: String(parsed?.wallet || ""), ts: Number(parsed?.ts || 0) };
    } catch {
      return { ok: false as const, error: "bad_session" };
    }
  }

  const v = getMemDB().kv.get(key);
  if (!v) return { ok: false as const, error: "session_expired" };
  return { ok: true as const, wallet: String(v?.wallet || ""), ts: Number(v?.ts || 0) };
}

export async function destroyAdminSession(token: string | null | undefined) {
  const t = String(token || "").trim();
  if (!t) return { ok: true as const };

  const key = `${SESSION_PREFIX}${t}`;
  const driver = pickDriver();

  if (driver === "kv") {
    const redis = await kvClient();
    await (redis as any).del(key);
    return { ok: true as const };
  }

  getMemDB().kv.delete(key);
  return { ok: true as const };
}
