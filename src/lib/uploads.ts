// Provider wrapper (Change 06). Swap to Cloudinary/UploadThing/R2 by replacing the
// body of uploadImage — nothing else in the app needs to change. The default is a
// local-disk provider via the /api/upload route (works on phone + PC immediately).
export type UploadResult = { url: string; thumbUrl?: string };

export async function uploadImage(file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return res.json();
}
