"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "Home" }, // ✅ 新增
  { href: "/mission/overview", label: "Overview" },
  { href: "/mission/missions", label: "Missions" },
  { href: "/mission/leaderboard", label: "Leaderboard" },
  { href: "/mission/rewards", label: "Rewards" },
  { href: "/mission/profile", label: "Profile" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function MissionNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2">
      {tabs.map((t) => {
        const active = isActive(pathname, t.href);

        return (
          <Link
            key={t.href}
            href={t.href}
            className={[
              "rounded-2xl px-4 py-2 text-sm border transition",
              active
                ? "bg-white text-zinc-900 border-zinc-900/20"
                : "bg-white/60 text-zinc-700 border-zinc-900/10 hover:bg-white",
            ].join(" ")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
