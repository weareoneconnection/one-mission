"use client";

import Link from "next/link";
import Image from "next/image";

export default function HomePage() {
  return (
    <main className="relative min-h-screen bg-[#faf9f6] text-zinc-900">
      {/* ultra subtle grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(0,0,0,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.03) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      <div className="relative flex min-h-screen items-center justify-center px-6">
        <div className="flex flex-col items-center text-center">
          {/* Logo – NO BOX, NO BACKGROUND */}
          <div className="mb-10">
            <Image
              src="/waoc-logo.png"
              alt="WAOC"
              width={200}
              height={200}
              priority
              className="select-none"
            />
          </div>

          {/* Main statement */}
          <h1 className="text-3xl md:text-4xl font-semibold tracking-wide text-zinc-900">
            We Are One Connection.
          </h1>

          {/* Philosophy line */}
          <p className="mt-4 text-base md:text-lg text-zinc-600 leading-relaxed max-w-xl">
            A decentralized experiment in connection, contribution, and meaning.
          </p>

          {/* Enter */}
          <Link
            href="/mission/overview"
            className="mt-10 inline-flex items-center justify-center rounded-full border border-zinc-900/20 bg-white/60 px-9 py-3.5 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-900 hover:text-white"
          >
            Enter
          </Link>

          {/* Trust line */}
          <p className="mt-6 text-xs text-zinc-500">
            No private keys required. Verify only via official links inside this site.
          </p>
        </div>
      </div>
    </main>
  );
}
