// Tiny swappable share helpers (Change 08). A real WhatsApp Business API / email
// sender can replace these later without touching callers.

/** wa.me link — opens WhatsApp (app or web) with a prefilled message. */
export function waLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const base = digits ? `https://wa.me/${digits}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

/** mailto link — opens the user's own mail app, prefilled; they attach the PO PDF. */
export function mailtoLink(email: string | null | undefined, subject: string, body: string): string {
  const to = email ?? "";
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
