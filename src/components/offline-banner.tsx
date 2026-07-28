"use client";

import { useEffect, useState } from "react";
import { depth } from "@/lib/offline-queue";
import { WifiOff } from "lucide-react";

/**
 * Change 36 Part 10 — registers the worker and says, plainly, when the app is offline.
 *
 * The banner is deliberately loud: someone standing at a cutting table needs to know that
 * what they just typed is queued rather than saved.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failing is not fatal — the app simply stays online-only.
      });
    }

    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);

    const tick = () => void depth().then(setQueued).catch(() => {});
    tick();
    const id = window.setInterval(tick, 15_000);

    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.clearInterval(id);
    };
  }, []);

  if (!offline && queued === 0) return null;

  return (
    <div
      className={`sticky top-0 z-40 flex items-center justify-center gap-2 px-3 py-1.5 t-xs font-semibold ${
        offline ? "bg-danger text-accent-on" : "bg-warn text-accent-on"
      }`}
    >
      <WifiOff size={13} />
      {offline ? "Offline — new entries are queued on this device" : `${queued} entr${queued === 1 ? "y" : "ies"} waiting to sync`}
    </div>
  );
}
