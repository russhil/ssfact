"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadImage } from "@/lib/uploads";
import { attachImages, removeImage } from "@/lib/actions";
import { ImagePlus, Camera, X, Loader2 } from "lucide-react";

export type GalleryImage = { id: number; url: string; thumbUrl: string | null; caption: string | null };

export function ImageUploader({
  entity,
  entityId,
  kind,
  multiple = false,
  images,
  label = "Photos",
}: {
  entity: "trim" | "fabric" | "fabricOrder" | "product";
  entityId: number;
  kind?: string;
  multiple?: boolean;
  images: GalleryImage[];
  label?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleFiles(files: FileList | File[]) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setBusy(true);
    setErr(null);
    try {
      const items = [];
      for (const f of multiple ? list : list.slice(0, 1)) items.push(await uploadImage(f));
      await attachImages({ entity, entityId, kind, items });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function del(id: number) {
    setBusy(true);
    try { await removeImage({ id }); router.refresh(); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</span>
        {busy && <Loader2 size={14} className="animate-spin text-primary" />}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
        onPaste={(e) => { const fs = [...e.clipboardData.files]; if (fs.length) handleFiles(fs); }}
        tabIndex={0}
        className={`rounded-xl border-2 border-dashed p-3 outline-none transition ${drag ? "border-primary bg-primary-soft" : "border-border"}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {images.map((img) => (
            <div key={img.id} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-border bg-slate-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.thumbUrl ?? img.url} alt={img.caption ?? ""} loading="lazy" className="h-full w-full object-cover" />
              <button onClick={() => del(img.id)} className="absolute right-0.5 top-0.5 rounded-full bg-black/55 p-0.5 text-white opacity-0 transition group-hover:opacity-100"><X size={12} /></button>
            </div>
          ))}

          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-border text-[10px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-40">
            <ImagePlus size={18} /> Add
          </button>
          <button type="button" onClick={() => camRef.current?.click()} disabled={busy} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-border text-[10px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-40 md:hidden">
            <Camera size={18} /> Camera
          </button>
        </div>
        <p className="mt-2 text-[10px] text-faint">Drag &amp; drop, paste, pick a file{multiple ? "s" : ""}, or use the camera on phone.</p>
        {err && <p className="mt-1 text-[10px] text-danger">{err}</p>}
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple={multiple} className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
    </div>
  );
}
