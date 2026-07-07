// Pure, client-safe display helpers for job cards (NO db import).
//
// A job card may reference a catalogue Product OR be a made-to-order item with only
// free-text custom fields (Change 12, Part D). These helpers resolve the display
// value from the product when present, else fall back to the custom fields — so no
// caller ever dereferences a possibly-null `job.product`.

export type JobDisplayLike = {
  product?: {
    itemDesc?: string | null;
    name?: string | null;
    skuCode?: string | null;
    styleNo?: string | null;
    mrp?: number | null;
  } | null;
  customItem?: string | null;
  customSku?: string | null;
  customStyle?: string | null;
  customMrp?: number | null;
};

export const jobItem = (j: JobDisplayLike): string =>
  j.product?.itemDesc ?? j.product?.name ?? j.customItem ?? "—";

export const jobSku = (j: JobDisplayLike): string =>
  j.product?.skuCode ?? j.customSku ?? "—";

export const jobStyle = (j: JobDisplayLike): string =>
  j.product?.styleNo ?? j.customStyle ?? j.product?.skuCode ?? j.customSku ?? "—";

export const jobMrp = (j: JobDisplayLike): number | null =>
  j.product?.mrp ?? j.customMrp ?? null;

/** True when the card has no catalogue product (made-to-order). */
export const isMadeToOrder = (j: { productId?: number | null }): boolean => j.productId == null;
