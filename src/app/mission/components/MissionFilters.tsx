"use client";

import React from "react";
import type { Mission, MissionCategory, MissionStatus } from "@/lib/mission/types";

type Props = {
  category: "all" | MissionCategory;
  setCategory: (v: "all" | MissionCategory) => void;

  status: "all" | MissionStatus;
  setStatus: (v: "all" | MissionStatus) => void;

  query: string;
  setQuery: (v: string) => void;

  sort: "default" | "points_desc" | "points_asc";
  setSort: (v: "default" | "points_desc" | "points_asc") => void;

  total: number;
  shown: number;
};

const cats: Array<{ key: Props["category"]; label: string }> = [
  { key: "all", label: "All" },
  { key: "growth", label: "Growth" },
  { key: "onchain", label: "On-chain" },
  { key: "contribution", label: "Contribution" },
  { key: "mindfulness", label: "Mindfulness" },
];

const statuses: Array<{ key: Props["status"]; label: string }> = [
  { key: "all", label: "All" },
  { key: "available", label: "Available" },
  { key: "completed", label: "Completed" },
  { key: "locked", label: "Locked" },
  { key: "cooldown", label: "Cooldown" },
];

export default function MissionFilters(props: Props) {
  return (
    <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {cats.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => props.setCategory(c.key)}
            className={[
              "rounded-full px-3 py-1 text-sm border",
              props.category === c.key
                ? "bg-zinc-900 text-white border-zinc-900"
                : "bg-white/60 border-zinc-900/10 hover:bg-white",
            ].join(" ")}
          >
            {c.label}
          </button>
        ))}

        <div className="mx-1 h-6 w-px bg-zinc-900/10" />

        <select
          value={props.status}
          onChange={(e) => props.setStatus(e.target.value as Props["status"])}
          className="rounded-xl border border-zinc-900/10 bg-white/70 px-3 py-2 text-sm"
        >
          {statuses.map((s) => (
            <option key={s.key} value={s.key}>
              Status: {s.label}
            </option>
          ))}
        </select>

        <select
          value={props.sort}
          onChange={(e) => props.setSort(e.target.value as Props["sort"])}
          className="rounded-xl border border-zinc-900/10 bg-white/70 px-3 py-2 text-sm"
        >
          <option value="default">Sort: Default</option>
          <option value="points_desc">Sort: Points (High → Low)</option>
          <option value="points_asc">Sort: Points (Low → High)</option>
        </select>

        <div className="flex-1" />

        <input
          value={props.query}
          onChange={(e) => props.setQuery(e.target.value)}
          placeholder="Search missions…"
          className="w-full sm:w-[320px] rounded-xl border border-zinc-900/10 bg-white/70 px-3 py-2 text-sm"
        />
      </div>

      <div className="mt-3 text-xs text-zinc-700">
        Showing <span className="font-semibold">{props.shown}</span> / {props.total}
      </div>
    </div>
  );
}
