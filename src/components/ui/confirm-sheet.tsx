"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { BottomSheet } from "./sheet";
import { cn } from "@/lib/cn";

/**
 * Change 40 — a styled confirm/prompt to replace the native window.confirm /
 * window.prompt scattered across row actions (void, unlock, delete, reset…),
 * which are unstyled and jarring on a phone. Mounted once at the app root; any
 * client component under it gets `useConfirm()` / `usePrompt()` returning a
 * promise, so `if (window.confirm(x))` becomes `if (await confirm({...}))`.
 */

type ConfirmOpts = {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};
type PromptOpts = ConfirmOpts & { placeholder?: string; defaultValue?: string; required?: boolean };

type Pending =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };

type Ctx = {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
};

const ConfirmContext = createContext<Ctx | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const resolver = useRef<Pending | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        const p: Pending = { kind: "confirm", opts, resolve };
        resolver.current = p;
        setPending(p);
      }),
    []
  );
  const prompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        const p: Pending = { kind: "prompt", opts, resolve };
        resolver.current = p;
        setText(opts.defaultValue ?? "");
        setPending(p);
      }),
    []
  );

  const settle = useCallback((value: boolean | string | null) => {
    const p = resolver.current;
    resolver.current = null;
    setPending(null);
    if (!p) return;
    if (p.kind === "confirm") (p.resolve as (v: boolean) => void)(value as boolean);
    else (p.resolve as (v: string | null) => void)(value as string | null);
  }, []);

  const onClose = () => settle(pending?.kind === "confirm" ? false : null);
  const onConfirm = () => {
    if (pending?.kind === "prompt") {
      if (pending.opts.required && !text.trim()) return;
      settle(text);
    } else settle(true);
  };

  const opts = pending?.opts;
  const danger = opts?.tone === "danger";

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}
      <BottomSheet
        open={pending != null}
        onClose={onClose}
        title={opts?.title}
        footer={
          <>
            <button onClick={onClose} className="rounded-lg px-4 py-2 t-sm font-semibold text-t2 active:scale-[0.97] hover:bg-surface-2">
              {opts?.cancelLabel ?? "Cancel"}
            </button>
            <button
              onClick={onConfirm}
              className={cn(
                "ml-auto rounded-lg px-5 py-2 t-sm font-semibold text-accent-on active:scale-[0.97]",
                danger ? "bg-danger" : "bg-accent"
              )}
            >
              {opts?.confirmLabel ?? (pending?.kind === "prompt" ? "Save" : "Confirm")}
            </button>
          </>
        }
      >
        {opts?.message && <p className="t-body text-t2">{opts.message}</p>}
        {pending?.kind === "prompt" && (
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onConfirm()}
            placeholder={pending.opts.placeholder}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 t-body outline-none focus:border-primary"
          />
        )}
      </BottomSheet>
    </ConfirmContext.Provider>
  );
}

function useConfirmCtx(): Ctx {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm/usePrompt must be used within <ConfirmProvider>");
  return ctx;
}

/** async replacement for window.confirm: `if (await confirm({title, message, tone})) {…}` */
export function useConfirm() {
  return useConfirmCtx().confirm;
}

/** async replacement for window.prompt: `const reason = await prompt({title, required:true})` (null = cancelled) */
export function usePrompt() {
  return useConfirmCtx().prompt;
}
