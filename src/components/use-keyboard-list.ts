"use client";

import { useEffect, useState, type KeyboardEvent } from "react";

/**
 * Arrow-key / Enter / Escape navigation for a combobox dropdown (Change 14 Part F).
 * Pass the number of options, a select(index) callback, and an optional onEscape.
 * Wire the returned `onKeyDown` to the text input and highlight rows where
 * index === activeIndex.
 */
export function useMemoKeyboardList(
  count: number,
  onSelect: (index: number) => void,
  onEscape?: () => void
) {
  const [activeIndex, setActiveIndex] = useState(0);
  // reset highlight to the top whenever the option set changes
  useEffect(() => { setActiveIndex(0); }, [count]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (count === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(count - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSelect(activeIndex);
    } else if (e.key === "Escape") {
      onEscape?.();
    }
  }

  return { activeIndex, onKeyDown };
}
