import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

// ---- kv driver (prod) ----
async function kvClient() {
  return getRedis();
}

function num(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function noStoreJson(data: any) {
  const res = NextResponse.json(data);
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const wallet = String(url.searchParams.get("wallet") || "").trim();
    const limit = Math.max(1, Math.min(500, num(url.searchParams.get("limit"), 200)));

    if (!wallet) {
      return noStoreJson({ ok: false, error: "missing wallet query (?wallet=...)" });
    }

    const driver = pickDriver();
    const kLedger = `ledger:${wallet}`;

    if (driver === "kv") {
      const redis = await kvClient();

      // Preferred: Redis List (JSON strings)
      if (typeof (redis as any).lRange === "function") {
        const raw = (await (redis as any).lRange(kLedger, 0, limit - 1)) as string[];
        const parsed = (raw || []).map(safeParse);

        // ✅ ensure newest first
        const a = parsed[0]?.ts;
        const b = parsed[parsed.length - 1]?.ts;
        const items =
          typeof a === "number" && typeof b === "number" && a < b
            ? [...parsed].reverse()
            : parsed;

        return noStoreJson({ ok: true, driver, wallet, items });
      }

      // Fallback: stored as JSON array string
      const blob = await (redis as any).get(kLedger);
      let arr: any[] = [];
      try {
        arr = blob ? JSON.parse(blob) : [];
      } catch {
        arr = [];
      }

      const items = Array.isArray(arr) ? arr : [];
      items.sort((x, y) => (Number(y?.ts) || 0) - (Number(x?.ts) || 0));

      return noStoreJson({ ok: true, driver, wallet, items: items.slice(0, limit) });
    }

    // memory
    const items = ((await memGet(kLedger)) ?? []) as any[];
    const list = Array.isArray(items) ? items : [];
    list.sort((x, y) => (Number(y?.ts) || 0) - (Number(x?.ts) || 0));

    return noStoreJson({ ok: true, driver, wallet, items: list.slice(0, limit) });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message ?? "history_error" });
  }
}
