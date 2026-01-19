import nacl from "tweetnacl";
import bs58 from "bs58";
import { getRedis } from "@/lib/server/redis";

type Driver = "memory" | "kv";

function pickDriver(): Driver {
  const v = String(process.env.MISSION_STORE_DRIVER || "memory").toLowerCase();
  return v === "kv" ? "kv" : "memory";
}

// ---- memory store (dev) ----
type MemDB = { kv: Map<string, any> };
function getMemDB(): MemDB {
  const g = globalThis as unknown as { __ONE_MISSION_MEMDB__?: MemDB };
  if (!g.__ONE_MISSION_MEMDB__) g.__ONE_MISSION_MEMDB__ = { kv: new Map() };
  return g.__ONE_MISSION_MEMDB__;
}
async function memGet(key: string) {
  return getMemDB().kv.get(key);
}
async function memSet(key: string, val: any) {
  getMemDB().kv.set(key, val);
}

function getAdminAllowlist() {
  return String(process.env.MISSION_ADMIN_WALLETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function nowMs() {
  return Date.now();
}

function parseMsg(msg: string) {
  // msg example:
  // WAOC One Mission Admin
  // wallet=<BASE58>
  // nonce=<RANDOM>
  // ts=<EPOCH_MS>
  const lines = String(msg || "").split("\n").map((s) => s.trim());
  const titleOk = lines[0] === "WAOC One Mission Admin";
  const kv: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const idx = line.indexOf("=");
    if (idx > 0) kv[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return {
    titleOk,
    wallet: kv.wallet || "",
    nonce: kv.nonce || "",
    ts: Number(kv.ts || 0),
  };
}

async function nonceSeen(nonceKey: string) {
  const driver = pickDriver();
  if (driver === "kv") {
    const redis = await getRedis();
    const v = await redis.get(nonceKey);
    return Boolean(v);
  }
  const v = await memGet(nonceKey);
  return Boolean(v);
}

async function markNonce(nonceKey: string, ttlSec: number) {
  const driver = pickDriver();
  if (driver === "kv") {
    const redis = await getRedis();
    await redis.set(nonceKey, "1");
    if (typeof redis.expire === "function") {
      await redis.expire(nonceKey, Math.max(30, ttlSec));
    }
    return;
  }
  await memSet(nonceKey, true);
}

function verifySignature(walletBase58: string, msg: string, sigBase58: string) {
  const pk = bs58.decode(walletBase58);
  const sig = bs58.decode(sigBase58);
  const data = new TextEncoder().encode(msg);
  return nacl.sign.detached.verify(data, sig, pk);
}

/**
 * ✅ Admin auth (signature + allowlist + nonce anti-replay)
 *
 * Client must send headers:
 * - x-admin-wallet: <base58 wallet>
 * - x-admin-msg:    <message string>
 * - x-admin-sig:    <base58 signature of msg>
 */
export async function requireAdminSigned(req: Request) {
  const allow = getAdminAllowlist();
  if (allow.length === 0) return { ok: false as const, error: "MISSION_ADMIN_WALLETS not set" };

  const wallet = (req.headers.get("x-admin-wallet") || "").trim();
  const msg = req.headers.get("x-admin-msg") || "";
  const sig = (req.headers.get("x-admin-sig") || "").trim();

  if (!wallet) return { ok: false as const, error: "missing x-admin-wallet" };
  if (!msg) return { ok: false as const, error: "missing x-admin-msg" };
  if (!sig) return { ok: false as const, error: "missing x-admin-sig" };

  const inAllow = allow.some((w) => w === wallet);
  if (!inAllow) return { ok: false as const, error: "unauthorized_wallet" };

  const parsed = parseMsg(msg);
  if (!parsed.titleOk) return { ok: false as const, error: "bad_msg_title" };
  if (parsed.wallet !== wallet) return { ok: false as const, error: "msg_wallet_mismatch" };
  if (!parsed.nonce || parsed.nonce.length < 8) return { ok: false as const, error: "bad_nonce" };

  const ttlSec = Number(process.env.MISSION_ADMIN_SIG_TTL_SEC || 600);
  const maxSkewMs = Math.max(60_000, ttlSec * 1000); // 至少 60s，默认 10min
  if (!Number.isFinite(parsed.ts) || parsed.ts <= 0) return { ok: false as const, error: "bad_ts" };

  const age = Math.abs(nowMs() - parsed.ts);
  if (age > maxSkewMs) return { ok: false as const, error: "signature_expired" };

  // ✅ anti-replay: nonce must be unique within TTL
  const nonceKey = `admin:nonce:${wallet}:${parsed.nonce}`;
  if (await nonceSeen(nonceKey)) return { ok: false as const, error: "nonce_replay" };

  // ✅ verify signature
  let okSig = false;
  try {
    okSig = verifySignature(wallet, msg, sig);
  } catch {
    okSig = false;
  }
  if (!okSig) return { ok: false as const, error: "bad_signature" };

  // mark nonce used
  await markNonce(nonceKey, ttlSec);

  return { ok: true as const, wallet };
}
