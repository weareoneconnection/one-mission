import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { mockMissions } from "@/lib/mission/mock";

type Mission = { id: string; points?: number; basePoints?: number };

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // ✅ 兼容两种字段名：walletAddress / wallet
    const wallet = String(body?.walletAddress || body?.wallet || "").trim();
    const missionId = String(body?.missionId || "").trim();

    if (!wallet || !missionId) {
      return NextResponse.json(
        { ok: false, error: "walletAddress + missionId required" },
        { status: 400 }
      );
    }

    const missions = (mockMissions as unknown as Mission[]) || [];
    const m = missions.find((x) => x.id === missionId);
    const add = Number(m?.basePoints ?? m?.points ?? 0);

    const missionKey = `u:${wallet}:missions`;

    // ✅ 去重：同钱包同任务只记一次
    const existed = await kv.sismember(missionKey, missionId);
    if (existed) {
      const [points, completed] = await Promise.all([
        kv.get<number>(`u:${wallet}:points`),
        kv.get<number>(`u:${wallet}:completed`),
      ]);

      return NextResponse.json({
        ok: true,
        wallet,
        missionId,
        duplicated: true,
        points: Number(points ?? 0),
        completed: Number(completed ?? 0),
      });
    }

    const pointsKey = `u:${wallet}:points`;
    const completedKey = `u:${wallet}:completed`;

    await kv.sadd(missionKey, missionId);

    const [newPoints, newCompleted] = await Promise.all([
      kv.incrby(pointsKey, add),
      kv.incrby(completedKey, 1),
    ]);

    await Promise.all([
      kv.zadd("lb:points", { score: Number(newPoints), member: wallet }),
      kv.zadd("lb:completed", { score: Number(newCompleted), member: wallet }),
    ]);

    return NextResponse.json({
      ok: true,
      wallet,
      missionId,
      duplicated: false,
      added: add,
      points: Number(newPoints),
      completed: Number(newCompleted),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "verify failed" },
      { status: 500 }
    );
  }
}
