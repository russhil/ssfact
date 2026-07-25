"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 t-body font-semibold text-accent-on shadow-sm hover:opacity-90"
    >
      <Printer size={15} /> Print / Save PDF
    </button>
  );
}
