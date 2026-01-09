import { NextResponse } from "next/server";

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
  const mod = await import("@vercel/kv");
  return mod.kv;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const wallet = String(url.searchParams.get("wallet") || "").trim();

    if (!wallet) {
      return NextResponse.json(
        { ok: false, error: "missing wallet query (?wallet=...)" },
        { status: 400 }
      );
    }

    const driver = pickDriver();
    const kPoints = `u:${wallet}:points`;
    const kCompleted = `u:${wallet}:completed`;

    const points =
      driver === "kv"
        ? Number((await (await kvClient()).get(kPoints)) ?? 0)
        : Number((await memGet(kPoints)) ?? 0);

    const completed =
      driver === "kv"
        ? Number((await (await kvClient()).get(kCompleted)) ?? 0)
        : Number((await memGet(kCompleted)) ?? 0);

    return NextResponse.json({
      ok: true,
      wallet,
      points,
      completed,
      driver,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "stats_error" },
      { status: 500 }
    );
  }
}
