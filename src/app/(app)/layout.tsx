import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { getCurrentUser } from "@/lib/auth";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="grid min-h-screen grid-cols-[208px_1fr]">
      <Sidebar role={user.role} displayName={user.displayName} />
      <main className="min-w-0">{children}</main>
    </div>
  );
}
