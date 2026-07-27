"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PenLine, X, Loader2 } from "lucide-react";
import { uploadImage } from "@/lib/uploads";
import { setUserSignature } from "@/lib/actions";
import { runAction } from "@/lib/action-result";

/**
 * Change 25 Part I.1 — load a staff member's signature once, print it on every PO
 * they raise.
 *
 * Goes through the same `uploadImage()` provider as every other image in the app, so
 * swapping local disk for object storage later changes one file and this keeps working.
 * Deliberately not an ImageAsset gallery: there is exactly one signature per person,
 * and a gallery would invite a second.
 */
export function SignatureUpload({ userId, signatureUrl }: { userId: number; signatureUrl: string | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(file: File | null) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    const ok = await runAction(async () => {
      const { url } = await uploadImage(file);
      await setUserSignature({ id: userId, url });
    }, setErr);
    if (ok) router.refresh();
    setBusy(false);
  }

  async function clear() {
    setBusy(true);
    if (await runAction(() => setUserSignature({ id: userId, url: null }), setErr)) router.refresh();
    setBusy(false);
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      {signatureUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={signatureUrl} alt="" className="h-6 w-16 object-contain" />
          <button onClick={clear} disabled={busy} className="text-faint hover:text-danger disabled:opacity-40" title="Remove signature">
            <X size={12} />
          </button>
        </>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1 t-xs font-semibold text-t3 hover:text-t1 disabled:opacity-40"
          title="Load signature"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <PenLine size={12} />} Load
        </button>
      )}
      {err && <span className="t-xs text-danger">{err}</span>}
    </span>
  );
}
