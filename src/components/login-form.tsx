"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/lib/auth-actions";
import { Button, Field, Input } from "@/components/ui";

const DEMO_LOGINS = [
  { user: "admin", role: "Admin — full access" },
  { user: "jyotika", role: "Staff" },
  { user: "fashion11", role: "Vendor — Fashion 11" },
  { user: "satya", role: "Trims" },
];

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Username" htmlFor="username">
        <Input id="username" name="username" type="text" autoComplete="username" autoFocus required placeholder="admin" />
      </Field>

      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••••"
        />
      </Field>

      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 t-sm font-medium text-danger">
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending} className="mt-1 justify-center">
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <div className="mt-2 rounded-xl bg-surface-2 px-3 py-3 t-xs leading-relaxed text-t2">
        <div className="mb-1.5 font-semibold text-t1">Demo logins</div>
        <ul className="flex flex-col gap-0.5">
          {DEMO_LOGINS.map((d) => (
            <li key={d.user} className="flex justify-between gap-3">
              <span className="font-mono text-t1">{d.user}</span>
              <span>{d.role}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1.5 text-t3">
          Password for all: <span className="font-mono text-t2">sportsun123</span>
        </div>
      </div>
    </form>
  );
}
