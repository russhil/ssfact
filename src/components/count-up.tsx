"use client";

import { useEffect, useRef, useState } from "react";

export function CountUp({
  value,
  dp = 0,
  prefix = "",
  suffix = "",
  duration = 900,
}: {
  value: number;
  dp?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const [n, setN] = useState(0);
  const ref = useRef<number | undefined>(undefined);

  useEffect(() => {
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(value * eased);
      if (p < 1) ref.current = requestAnimationFrame(tick);
    };
    ref.current = requestAnimationFrame(tick);
    return () => {
      if (ref.current) cancelAnimationFrame(ref.current);
    };
  }, [value, duration]);

  return (
    <span className="tnum">
      {prefix}
      {n.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp })}
      {suffix}
    </span>
  );
}
