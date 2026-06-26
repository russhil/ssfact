"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/lib/auth-actions";

const DEMO_LOGINS = [
  { user: "admin", role: "Admin — full access" },
  { user: "jyotika", role: "Staff" },
  { user: "fashion11", role: "Vendor — Fashion 11" },
  { user: "satya", role: "Trims" },
];

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    login,
    {}
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="username"
          className="text-[12px] font-semibold text-slate-600"
        >
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoFocus
          required
          className="rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-soft"
          placeholder="admin"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-[12px] font-semibold text-slate-600"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-soft"
          placeholder="••••••••••"
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12px] font-medium text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-lg bg-primary px-3.5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-indigo-600 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <div className="mt-2 rounded-xl bg-slate-50 px-3 py-3 text-[11px] leading-relaxed text-muted">
        <div className="mb-1 font-semibold text-slate-600">Demo logins</div>
        <ul className="space-y-0.5">
          {DEMO_LOGINS.map((d) => (
            <li key={d.user} className="flex justify-between gap-3">
              <span className="font-mono text-slate-600">{d.user}</span>
              <span>{d.role}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1.5 text-faint">
          Password for all:{" "}
          <span className="font-mono text-slate-500">sportsun123</span>
        </div>
      </div>
    </form>
  );
}
