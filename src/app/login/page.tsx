import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <div className="grid min-h-screen place-items-center bg-app px-4 py-10">
      <div className="w-full max-w-sm rise">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-accent t-head font-black text-accent-on">
            S
          </span>
          <span className="leading-tight">
            <span className="block t-title font-extrabold">Sportsun</span>
            <span className="block t-xs text-t3">Production OS</span>
          </span>
        </div>

        <Card className="px-6 py-7">
          <div className="mb-5">
            <h1 className="t-title font-bold">Sign in</h1>
            <p className="mt-1 t-sm text-t2">Garment production &amp; inventory ERP</p>
          </div>
          <LoginForm />
        </Card>
      </div>
    </div>
  );
}
