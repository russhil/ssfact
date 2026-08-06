"use client";

import { useEffect, useState } from "react";

/**
 * True below the `md` breakpoint (767px), matching the CSS the shell uses to
 * swap desktop chrome for mobile chrome. Used ONLY for behavioural branches CSS
 * can't express — a bottom sheet vs the right-side Sheet, a card list vs a
 * table. Layout presence itself is chosen by CSS (both chromes are in the DOM),
 * so the initial `false` here matches the server render and never causes a
 * hydration flip of the frame.
 */
export function useIsMobile(query = "(max-width: 767px)"): boolean {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const sync = () => setMobile(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [query]);

  return mobile;
}
