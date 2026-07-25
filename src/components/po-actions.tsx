"use client";

import { useRouter } from "next/navigation";
import { markPOSent, markTrimPOSent } from "@/lib/actions";
import { waLink, mailtoLink } from "@/lib/share";
import { Printer, Mail, MessageCircle } from "lucide-react";

export function POActions({
  orderId, email, phone, subject, summary, kind = "FABRIC",
}: {
  orderId: number; email: string | null; phone: string | null; subject: string; summary: string;
  /** Change 18 Part B: trim POs live in their own table and series (POT-YYYY-NNN). */
  kind?: "FABRIC" | "TRIM";
}) {
  const router = useRouter();
  async function share(href: string) {
    try { await (kind === "TRIM" ? markTrimPOSent({ id: orderId }) : markPOSent({ id: orderId })); } catch { /* ignore */ }
    window.open(href, "_blank");
    router.refresh();
  }
  const btn = "no-print inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 t-body font-semibold shadow-sm";
  return (
    <div className="no-print flex flex-wrap gap-2">
      <button onClick={() => window.print()} className={`${btn} bg-primary text-accent-on hover:opacity-90`}>
        <Printer size={15} /> Download PDF
      </button>
      <button onClick={() => share(mailtoLink(email, subject, summary))} className={`${btn} border border-border bg-surface hover:bg-surface-2`}>
        <Mail size={15} /> Email{email ? "" : " (no address)"}
      </button>
      <button onClick={() => share(waLink(phone, summary))} className={`${btn} border border-border bg-surface hover:bg-surface-2`}>
        <MessageCircle size={15} /> WhatsApp
      </button>
    </div>
  );
}
