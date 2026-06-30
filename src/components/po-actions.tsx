"use client";

import { useRouter } from "next/navigation";
import { markPOSent } from "@/lib/actions";
import { waLink, mailtoLink } from "@/lib/share";
import { Printer, Mail, MessageCircle } from "lucide-react";

export function POActions({
  orderId, email, phone, subject, summary,
}: {
  orderId: number; email: string | null; phone: string | null; subject: string; summary: string;
}) {
  const router = useRouter();
  async function share(href: string) {
    try { await markPOSent({ id: orderId }); } catch { /* ignore */ }
    window.open(href, "_blank");
    router.refresh();
  }
  const btn = "no-print inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold shadow-sm";
  return (
    <div className="no-print flex flex-wrap gap-2">
      <button onClick={() => window.print()} className={`${btn} bg-primary text-white hover:bg-indigo-600`}>
        <Printer size={15} /> Download PDF
      </button>
      <button onClick={() => share(mailtoLink(email, subject, summary))} className={`${btn} border border-border bg-white hover:bg-slate-50`}>
        <Mail size={15} /> Email{email ? "" : " (no address)"}
      </button>
      <button onClick={() => share(waLink(phone, summary))} className={`${btn} border border-border bg-white hover:bg-slate-50`}>
        <MessageCircle size={15} /> WhatsApp
      </button>
    </div>
  );
}
