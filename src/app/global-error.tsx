"use client";

import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

/**
 * Change 25 Part B — the last resort.
 *
 * Only fires when the root layout itself throws, which means the app shell is
 * gone: this component replaces <html>/<body> entirely, so it cannot use the
 * sidebar, the theme boot script, or anything that assumes the layout rendered.
 * Kept to plain tokens and a reload for exactly that reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full">
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
          <h1 className="t-head font-semibold text-t1">Application failed to load</h1>
          {error.message && <p className="max-w-[46ch] t-sm text-t2">{error.message}</p>}
          <button
            onClick={reset}
            className="mt-2 rounded-lg bg-accent px-4 py-2 t-sm font-semibold text-accent-on"
          >
            Reload
          </button>
          {error.digest && <p className="font-mono t-xs text-t3">Ref {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
