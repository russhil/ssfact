import { redirect } from "next/navigation";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getCurrentUser } from "@/lib/auth";
import { dbPath } from "@/lib/backup";
import { PageHeader, Panel, ButtonLink, DefList } from "@/components/ui";
import { fmtDate, num } from "@/lib/format";

export const dynamic = "force-dynamic";

const MB = (b: number) => `${(b / 1_048_576).toFixed(1)} MB`;

export default async function SettingsPage() {
  const me = await getCurrentUser();
  if (me?.role !== "ADMIN") redirect("/");

  const dir = resolve(process.env.BACKUP_DIR ?? "backups");
  const backups = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.startsWith("ssfact-") && f.endsWith(".sqlite"))
        .map((f) => ({ f, s: statSync(join(dir, f)) }))
        .sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)
    : [];

  const src = dbPath();
  const dbSize = existsSync(src) ? statSync(src).size : 0;
  const latest = backups[0];

  return (
    <div className="p-6">
      <PageHeader title="Settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Database backup"
          actions={
            <ButtonLink href="/settings/backup" size="sm" variant="primary" prefetch={false}>
              Download backup
            </ButtonLink>
          }
        >
          <DefList
            items={[
              { label: "Database size", value: MB(dbSize) },
              { label: "Backups retained", value: num(backups.length) },
              { label: "Last backup", value: latest ? fmtDate(latest.s.mtime) : "—" },
              { label: "Last backup size", value: latest ? MB(latest.s.size) : "—" },
            ]}
          />
        </Panel>

        <Panel title="Recent backups" pad={backups.length === 0}>
          {backups.length === 0 ? (
            <p className="t-sm text-t3">None yet</p>
          ) : (
            <table className="w-full t-sm">
              <tbody>
                {backups.slice(0, 14).map((b) => (
                  <tr key={b.f} className="border-b border-hairline last:border-0">
                    <td className="px-5 py-2 font-mono t-xs text-t2">{b.f}</td>
                    <td className="px-5 py-2 text-right text-t3 tnum">{MB(b.s.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
