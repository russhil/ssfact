import { cn } from "@/lib/cn";

/* The Sport Sun artwork ships as white ink on a flat orange plate. The plate is
   stripped in `public/brand/*` so only the alpha survives; `.brand` then paints
   that alpha with currentColor. One asset therefore reads correctly on the light
   theme, the dark theme and the inverted panels — no second file, no `dark:`.
   See the .brand rules in globals.css.

   The supplied logo is a single-colour mark, so painting the whole lockup one
   colour is faithful to it — the original is just white instead of terracotta. */

/* Intrinsic aspect ratios of the extracted art. The mask is `contain`, so the
   box has to match or the logo floats inside dead space. */
const LOGO = 1024 / 624; // stacked lockup: sun above the wordmark
const SUN = 512 / 508;
const MARK = 512 / 687;

/**
 * The Sport Sun logo, exactly as supplied: the sun sitting above the wordmark.
 * Sized by width, since that is what the containers here actually constrain.
 */
export function BrandLogo({
  width = 148,
  className,
}: {
  width?: number;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label="Sport Sun"
      className={cn("brand-logo block shrink-0", className)}
      style={{ width, height: Math.round(width / LOGO) }}
    />
  );
}

/** The sun device alone — for spots too small for the full lockup. */
export function BrandSun({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label="Sport Sun"
      className={cn("brand-sun block shrink-0", className)}
      style={{ height: size, width: Math.round(size * SUN) }}
    />
  );
}

/** The "S" monogram — matches the favicon, for avatars and compact chrome. */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label="Sport Sun"
      className={cn("brand-mark block shrink-0", className)}
      style={{ height: size, width: Math.round(size * MARK) }}
    />
  );
}

/** The logo with the product name under it, for the sidebar and the login card. */
export function BrandLockup({
  width = 140,
  subtitle = "Production OS",
  className,
}: {
  width?: number;
  subtitle?: string | null;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 flex-col items-center gap-1.5", className)}>
      <BrandLogo width={width} className="text-accent" />
      {subtitle && <span className="block truncate t-xs text-t3">{subtitle}</span>}
    </span>
  );
}

/**
 * Letterhead for the printed documents (PO, challan, dispatch note).
 *
 * Deliberately an <img> of pre-coloured art rather than the CSS mask the app
 * chrome uses: a mask paints via background-color, which browsers drop unless
 * the user ticks "background graphics" in the print dialog. An <img> always
 * renders, and these go out to suppliers.
 */
export function BrandLetterhead({ height = 52 }: { height?: number }) {
  return (
    <img
      src="/brand/logo-print.png"
      alt="Sport Sun"
      height={height}
      style={{ height, width: "auto" }}
    />
  );
}
