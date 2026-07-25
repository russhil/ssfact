import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <div className="grid min-h-screen place-items-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-base font-black text-accent-on">
            S
          </span>
          <span className="t-title font-extrabold tracking-tight">
            Sportsun
          </span>
        </div>

        <Card className="px-6 py-7 shadow-sm">
          <div className="mb-5">
            <h1 className="t-title font-bold">Sign in</h1>
            <p className="mt-0.5 t-sm text-muted">
              Production OS — garment manufacturing ERP
            </p>
          </div>
          <LoginForm />
        </Card>
      </div>
    </div>
  );
}
