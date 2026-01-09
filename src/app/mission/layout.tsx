import React from "react";
import WalletProviders from "@/components/solana/WalletProviders";
import MissionNav from "./components/MissionNav";
import { MissionProvider } from "@/lib/mission/store";

export default function MissionLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletProviders>
      <MissionProvider>
        <div className="min-h-screen bg-[#f7f6f2] text-zinc-900">
          {/* 顶部区域：导航 */}
          <div className="sticky top-0 z-40 border-b border-zinc-200/70 bg-[#f7f6f2]/85 backdrop-blur">
            <div className="mx-auto w-full max-w-6xl px-6 py-4">
              <MissionNav />
            </div>
          </div>

          {/* 内容区域 */}
          <main className="mx-auto w-full max-w-6xl px-6 py-8">
            <div className="space-y-8">{children}</div>
          </main>
        </div>
      </MissionProvider>
    </WalletProviders>
  );
}
