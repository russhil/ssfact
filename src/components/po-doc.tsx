import { inr, num } from "@/lib/format";

/**
 * Change 25 — the blocks both PO documents share.
 *
 * /po and /pot were ~80% duplicated: the same print CSS, the same wrapper, the same
 * totals table, the same two signature blocks. Parts G.3 (issuing firm), I (signatory),
 * K.2 (GST) and K.3 (attachment pages) each had to change in both, so they moved here
 * and now change once.
 */

export type DocParty = {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gstNo?: string | null;
};

export type DocBuyer = {
  name: string;
  gstNo: string | null;
  city: string | null;
  address: string | null;
  billingAddress: string | null;
  contacts: { label: string; phone: string | null }[];
};

export type DocImage = { id: number; url: string; thumbUrl: string | null; caption: string | null };

/* ------------------------------------------------------------------ shell -- */

/** The print CSS + page wrapper, previously copy-pasted into all six doc routes. */
export function DocShell({ children }: { children: React.ReactNode }) {
  // Change 40 A2 — the exported PDF was carrying browser chrome in its corners: a
  // timestamp, the tab title, "1/1", and the live URL (which handed a supplier the
  // production address + internal row id). Those are drawn by the browser only because
  // window.print() runs with a non-zero @page margin; setting `@page { margin: 0 }`
  // leaves most browsers nowhere to draw them, so they are omitted. The 14mm page margin
  // moves into the frame padding so the layout is unchanged.
  //   ⚠️ Browser-dependent — verify on the export device. iOS Safari exposes no
  //   headers/footers toggle, so this is the only lever there.
  // Change 40 A3 — with the browser's "1/1" gone there is no page number at all, so we
  // print our own via @page margin-box counters. NOTE: Chromium/WebKit do not render
  // @page margin-box content, so "Page X of N" shows only in engines that do (Firefox /
  // print-CSS-compliant). Left in as the standards-correct approach; flagged for device
  // verification per the spec.
  return (
    <div className="doc-light doc-print-frame mx-auto max-w-[800px] bg-white p-8 text-[12px] text-ink">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
          @page {
            margin: 0;
            @bottom-center { content: "Page " counter(page) " of " counter(pages); font-size: 9px; color: #64748b; }
          }
          .doc-print-frame { padding: 14mm !important; }
        }
      `}</style>
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- parties -- */

/**
 * Change 25 Part G.3 — both ends of the order.
 *
 * FROM is the firm we issue under (its GST, registered address, billing address and the
 * chosen ship-to). TO is the supplier with its GST. The owner runs several firms, so a
 * PO that does not say which one issued it is not a usable tax document.
 *
 * Falls back to a supplier-only block on an order raised before firms existed.
 */
export function PoParties({
  supplier,
  buyer,
  shipTo,
}: {
  supplier: DocParty | null;
  buyer: DocBuyer | null;
  shipTo: { label: string | null; address: string } | null;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-4 text-[12px]">
      <div>
        <div className="text-faint">To (Supplier)</div>
        <div className="font-semibold">{supplier?.name ?? "—"}</div>
        {supplier?.address && <div className="text-slate-600">{supplier.address}</div>}
        {supplier?.phone && <div className="text-slate-600">{supplier.phone}</div>}
        {supplier?.gstNo && <div className="text-slate-600">GSTIN: {supplier.gstNo}</div>}
      </div>
      {buyer && (
        <div>
          <div className="text-faint">From</div>
          <div className="font-semibold">{buyer.name}</div>
          {buyer.address && <div className="text-slate-600">{buyer.address}</div>}
          {buyer.city && <div className="text-slate-600">{buyer.city}</div>}
          {buyer.gstNo && <div className="text-slate-600">GSTIN: {buyer.gstNo}</div>}
          {buyer.contacts.length > 0 && (
            <div className="text-slate-600">
              {buyer.contacts.map((c) => (c.phone ? `${c.label} · ${c.phone}` : c.label)).join(", ")}
            </div>
          )}
        </div>
      )}
      {(buyer?.billingAddress || shipTo) && (
        <>
          {buyer?.billingAddress && (
            <div>
              <div className="text-faint">Bill to</div>
              <div className="text-slate-600">{buyer.billingAddress}</div>
            </div>
          )}
          {shipTo && (
            <div>
              <div className="text-faint">Ship to{shipTo.label ? ` (${shipTo.label})` : ""}</div>
              <div className="text-slate-600">{shipTo.address}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ totals -- */

/**
 * Change 25 Part K.2 — Subtotal → GST @ n% → Grand Total.
 *
 * `gstRate` is stored on the order, so a reprint computes the identical figure. With no
 * rate set the tax rows are omitted entirely and the block prints exactly as it did
 * before this change. A single GST% is enough now; a CGST/SGST split can be added later
 * without disturbing the stored rate.
 */
export function PoTotals({
  subtotal,
  gstRate,
  colSpan,
}: {
  subtotal: number;
  gstRate: number | null;
  /** Leading columns to skip so the labels sit under the Amount column. */
  colSpan: number;
}) {
  const gst = gstRate != null && gstRate > 0 ? Math.round(subtotal * gstRate) / 100 : null;
  const grand = subtotal + (gst ?? 0);
  return (
    <>
      <tr className="border-t border-ink font-semibold">
        <td className="px-2 py-1.5" colSpan={colSpan}>Subtotal</td>
        <td className="px-2 py-1.5 text-right tnum">{inr(subtotal)}</td>
      </tr>
      {gst != null && (
        <tr>
          <td className="px-2 py-1.5" colSpan={colSpan}>GST @ {num(gstRate, 2)}%</td>
          <td className="px-2 py-1.5 text-right tnum">{inr(gst)}</td>
        </tr>
      )}
      <tr className="border-t border-ink font-bold">
        <td className="px-2 py-1.5" colSpan={colSpan}>Grand Total</td>
        <td className="px-2 py-1.5 text-right tnum">{inr(grand)}</td>
      </tr>
    </>
  );
}

/* --------------------------------------------------------------- signatory -- */

/**
 * Change 25 Part I — the authorised-signature block, no longer empty.
 *
 * Prints the staff member who generated the PO and, when they have loaded one, their
 * signature image above the line. The "Supplier acknowledgement" block that used to sit
 * opposite is deliberately gone: the PO is our authorisation, not their counter-signature,
 * and the owner does not want to push the supplier into a sign-and-return step.
 */
export function PoSignatory({
  signatory,
  preparedBy = null,
}: {
  signatory: { name: string; signatureUrl: string | null } | null;
  /** Change 39 G2 — the staff who raised the PO (display only). */
  preparedBy?: { name: string; at: Date | null } | null;
}) {
  return (
    <>
      <div className="mt-10 flex justify-end text-[11px]">
        <div className="w-56 text-center">
          {signatory?.signatureUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={signatory.signatureUrl} alt="" className="mx-auto mb-1 h-12 object-contain" />
          )}
          <div className="border-t border-ink pt-1">
            <div className="font-semibold">{signatory?.name ?? ""}</div>
            <div className="text-slate-600">Authorised signatory</div>
          </div>
        </div>
      </div>
      {preparedBy && (
        <div className="mt-4 text-[11px] text-slate-600">
          Prepared by {preparedBy.name}
          {preparedBy.at ? ` · ${new Date(preparedBy.at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : ""}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------- attachments -- */

/**
 * Change 25 Part K.3 — each attached JPG becomes its own page inside the exported PDF.
 *
 * Export is `window.print()` → the browser's Save as PDF, so anything that prints is
 * captured: a page-break plus a fit-to-page image is all it takes for a PO with a shade
 * card to come out as details (page 1) + the shade card (page 2). Deliberately NOT
 * `no-print` — that class is what would exclude it.
 */
export function DocAttachments({
  images,
  label,
  showThumbnails = true,
}: {
  images: DocImage[];
  label: string;
  /**
   * False where an <ImageUploader> is already mounted on the same document — it
   * renders its own gallery, and two thumbnail strips of the same images is noise.
   */
  showThumbnails?: boolean;
}) {
  if (images.length === 0) return null;
  return (
    <>
      {/* on screen: thumbnails only — the full-page render is for the printer */}
      {showThumbnails && (
        <div className="no-print mt-6 border-t border-slate-200 pt-3">
          <div className="mb-2 text-[11px] text-faint">{label}</div>
          <div className="flex flex-wrap gap-2">
            {images.map((im) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={im.id} src={im.thumbUrl ?? im.url} alt="" className="h-20 w-20 rounded object-cover" />
            ))}
          </div>
        </div>
      )}

      {images.map((im) => (
        // Change 40 A1 — break-inside-avoid keeps one image off a page seam; the frame now
        // supplies the page margin (@page margin:0), so pad the block and cap the image at
        // 230mm (usable A4 height after 14mm×2 margin) so a portrait photo cannot overflow.
        <div key={`page-${im.id}`} className="hidden break-before-page break-inside-avoid p-[14mm] print:block">
          <div className="mb-2 text-[11px] font-semibold">{im.caption ?? label}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={im.url} alt="" className="max-h-[230mm] w-full object-contain" />
        </div>
      ))}
    </>
  );
}

/* ---------------------------------------------------------------- metadata -- */

/**
 * Change 25 Part K.1 — what "Save as PDF" names the file.
 *
 * Every doc route inherited the root layout title, so every exported PDF was called
 * "Sport Sun — Production OS" regardless of what it was. The browser uses
 * `document.title` as the default filename, so setting it per document is the whole fix.
 */
export const docTitle = (docNo: string | null, fallback: string) => `Sport Sun ${docNo ?? fallback}`;
