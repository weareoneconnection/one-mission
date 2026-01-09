import { mockMissions } from "@/lib/mission/mock"; // ⚠️按你实际路径改
import type { Mission } from "@/lib/mission/types";

export function getMissionById(id: string): Mission | null {
  return mockMissions.find((m) => String(m.id) === String(id)) ?? null;
}
