"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  Factory,
  FileText,
  LayoutDashboard,
  LayoutGrid,
  Moon,
  Package,
  Scissors,
  Search,
  ShoppingCart,
  Sun,
  Truck,
  Users,
  X,
} from "lucide-react";
import "./lab.css";

/* ------------------------------------------------------------------ */
/* types — mirrors the real dashboard payload                          */
/* ------------------------------------------------------------------ */

export type LabData = {
  kpis: { totalCut: number; totalDispatched: number; balance: number; overdue: number; totalJobs: number; activeJobs: number; fillRate: number };
  vendors: { name: string; cut: number; disp: number; fill: number }[];
  overdue: { siNo: string; item: string; daysLate: number }[];
  trend: { label: string; cut: number }[];
  jobs: {
    id: number;
    siNo: string;
    item: string;
    vendor: string;
    stage: string;
    cutQty: number;
    dispatchedQty: number;
    etd: string | null;
    late: boolean;
  }[];
};

type Direction = "azadi" | "apple";
type Mode = "light" | "dark";

const DIRECTIONS: { id: Direction; label: string }[] = [
  { id: "azadi", label: "Azadi-faithful" },
  { id: "apple", label: "Apple-industrial" },
];

const NAV = [
  { group: "Overview", items: [
    { label: "Dashboard", icon: LayoutDashboard, current: true },
    { label: "Production Board", icon: LayoutGrid },
    { label: "Job Cards", icon: ClipboardList, count: 128 },
  ]},
  { group: "Materials", items: [
    { label: "Inventory", icon: Boxes },
    { label: "Fabric Orders", icon: ShoppingCart },
    { label: "Trims", icon: Scissors },
    { label: "Pending Trims", icon: AlertTriangle, count: 6 },
    { label: "Challans", icon: FileText },
  ]},
  { group: "Network", items: [
    { label: "Vendors", icon: Factory },
    { label: "Suppliers", icon: Users },
    { label: "Dispatch", icon: Truck },
    { label: "Product Master", icon: Package },
  ]},
];

const nf = new Intl.NumberFormat("en-IN");
const num = (n: number) => nf.format(Math.round(n));
const pct = (n: number) => `${Math.round((Number.isFinite(n) ? n : 0) * 100)}%`;

/* ------------------------------------------------------------------ */

export function Lab({ data }: { data: LabData }) {
  const [dir, setDir] = useState<Direction>("azadi");
  const [mode, setMode] = useState<Mode>("light");
  const [selected, setSelected] = useState<LabData["jobs"][number] | null>(null);

  return (
    <div className="lab" data-dir={dir} data-mode={mode}>
      <LabBar dir={dir} setDir={setDir} mode={mode} setMode={setMode} />

      <div className="frame">
        <Side />
        <main className="main">
          <div className="topbar">
            <nav className="crumbs">
              Sportsun <span>/</span> <b>Production Dashboard</b>
            </nav>
            <div className="search">
              <Search size={13} strokeWidth={2.2} />
              Search SI no, style, vendor
              <kbd>⌘K</kbd>
            </div>
          </div>

          <div className="page">
            <Dashboard data={data} onPick={setSelected} selected={selected} />
          </div>
        </main>
      </div>

      {/* scrim + sheet always mounted so enter/exit share one path */}
      <button
        className="scrim"
        data-open={selected ? "true" : "false"}
        aria-label="Close detail"
        onClick={() => setSelected(null)}
        style={{ pointerEvents: selected ? "auto" : "none" }}
      />
      <JobSheet job={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* lab chrome                                                          */
/* ------------------------------------------------------------------ */

function LabBar({
  dir, setDir, mode, setMode,
}: {
  dir: Direction; setDir: (d: Direction) => void;
  mode: Mode; setMode: (m: Mode) => void;
}) {
  return (
    <header className="labbar">
      <span className="labbar__title">Design Lab</span>
      <Segmented value={dir} onChange={setDir} options={DIRECTIONS} />
      <button
        className="btn btn--ghost"
        onClick={() => setMode(mode === "light" ? "dark" : "light")}
        aria-label={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
      >
        {mode === "light" ? <Moon size={14} strokeWidth={2.2} /> : <Sun size={14} strokeWidth={2.2} />}
        {mode === "light" ? "Dark" : "Light"}
      </button>
      <span className="labbar__spacer" />
      <p className="labbar__hint">
        Same markup, same live data — only the design system changes. Click a job row to feel the
        sheet motion; both directions ship light + dark.
      </p>
    </header>
  );
}

function Segmented<T extends string>({
  value, onChange, options,
}: {
  value: T; onChange: (v: T) => void; options: { id: T; label: string }[];
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ x: 0, w: 0 });

  // measure the active button and drive the indicator from its real box
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>(`[data-id="${value}"]`);
    if (!el || !wrap.current) return;
    setThumb({ x: el.offsetLeft - 3, w: el.offsetWidth });
  }, [value]);

  return (
    <div className="seg" ref={wrap} role="group">
      <span className="seg__thumb" style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }} />
      {options.map((o) => (
        <button
          key={o.id}
          data-id={o.id}
          className="seg__btn"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* shell                                                               */
/* ------------------------------------------------------------------ */

function Side() {
  return (
    <aside className="side">
      <div className="brand">
        <span className="brand__mark">S</span>
        <span>
          <div className="brand__name">Sportsun</div>
          <div className="brand__sub">Production OS</div>
        </span>
      </div>

      <nav>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="navgroup">{g.group}</div>
            {g.items.map(({ label, icon: Icon, count, current }) => (
              <button key={label} className="navitem" aria-current={current ? "page" : undefined}>
                <Icon size={15} strokeWidth={current ? 2.4 : 2} />
                {label}
                {count != null && <span className="navitem__count">{count}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="side__foot">
        <div className="user">
          <span className="user__av">R</span>
          <span>
            <div className="user__name">Russhil</div>
            <div className="user__role">Admin</div>
          </span>
        </div>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* dashboard                                                           */
/* ------------------------------------------------------------------ */

function Dashboard({
  data, onPick, selected,
}: {
  data: LabData;
  onPick: (j: LabData["jobs"][number]) => void;
  selected: LabData["jobs"][number] | null;
}) {
  const { kpis, vendors, overdue, trend, jobs } = data;

  const cards = [
    { label: "Total Cut", value: kpis.totalCut, foot: `${num(kpis.totalJobs)} job cards`, tone: "" },
    { label: "Received", value: kpis.totalDispatched, foot: `${pct(kpis.fillRate)} fill rate`, tone: "" },
    { label: "Balance to Receive", value: kpis.balance, foot: `across ${num(kpis.activeJobs)} active jobs`, tone: "" },
    { label: "Overdue Jobs", value: kpis.overdue, foot: "ETD passed · needs action", tone: "danger" },
  ];

  return (
    <>
      <div className="phead rise">
        <div>
          <h1>Production Dashboard</h1>
          <p>
            Live across {num(kpis.totalJobs)} job cards. “Received” means stitched goods back in the
            warehouse — market dispatch to dealers is tracked separately.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn">Export</button>
          <button className="btn btn--primary">New Job Card</button>
        </div>
      </div>

      <section className="kpis rise" style={{ animationDelay: "60ms" }}>
        {cards.map((c) => (
          <article className="kpi" key={c.label}>
            <div className="kpi__label">{c.label}</div>
            <div className="kpi__value" data-tone={c.tone || undefined}>{num(c.value)}</div>
            <div className="kpi__foot" data-tone={c.tone || undefined}>{c.foot}</div>
          </article>
        ))}
      </section>

      <div className="grid2 rise" style={{ animationDelay: "120ms" }}>
        <section className="panel">
          <header className="panel__head">
            <h3 className="panel__title">Vendor dispatch progress</h3>
            <span className="panel__note">active jobs</span>
          </header>
          <div className="panel__body">
            {vendors.length === 0 && <p className="panel__note">No active vendor workload.</p>}
            {vendors.map((v, i) => (
              <div className="vrow" key={v.name}>
                <span className="vrow__name">{v.name}</span>
                <span className="bar">
                  <i
                    className="bar__fill"
                    data-tone={v.fill < 0.5 ? "warn" : v.fill >= 0.95 ? "ok" : undefined}
                    style={{ width: `${Math.min(100, v.fill * 100)}%`, animationDelay: `${140 + i * 45}ms` }}
                  />
                </span>
                <span className="vrow__pct">{pct(v.fill)}</span>
                <span className="vrow__qty">{num(v.cut)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <header className="panel__head">
            <h3 className="panel__title">Overdue</h3>
            <span className="panel__note">needs action · top 5</span>
          </header>
          <div className="panel__body">
            {overdue.length === 0 && <p className="panel__note">Nothing overdue.</p>}
            {overdue.map((o) => (
              <button className="orow" key={o.siNo}>
                <span>
                  <span className="orow__si">{o.siNo}</span>
                  <span className="orow__item">{o.item}</span>
                </span>
                <span className="tag" data-tone="danger">
                  <i className="dot" />
                  {o.daysLate}d late
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="panel rise" style={{ animationDelay: "180ms", marginTop: "var(--gap)" }}>
        <header className="panel__head">
          <h3 className="panel__title">Weekly production trend</h3>
          <span className="panel__note">cut qty by order week</span>
        </header>
        <div className="panel__body">
          <TrendChart data={trend} />
        </div>
      </section>

      <section className="tablewrap rise" style={{ animationDelay: "240ms" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>SI No</th>
              <th>Item</th>
              <th>Vendor</th>
              <th>Stage</th>
              <th className="num">Cut</th>
              <th className="num">Received</th>
              <th>Progress</th>
              <th>ETD</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const fill = j.cutQty > 0 ? j.dispatchedQty / j.cutQty : 0;
              return (
                <tr key={j.id} data-sel={selected?.id === j.id} onClick={() => onPick(j)}>
                  <td className="si">{j.siNo}</td>
                  <td>{j.item}</td>
                  <td className="muted">{j.vendor}</td>
                  <td>
                    <span className="tag" data-tone={j.stage === "DISPATCH" ? "ok" : "accent"}>{j.stage}</span>
                  </td>
                  <td className="num">{num(j.cutQty)}</td>
                  <td className="num">{num(j.dispatchedQty)}</td>
                  <td>
                    <span className="minibar">
                      <i style={{ width: `${Math.min(100, fill * 100)}%` }} />
                    </span>
                  </td>
                  <td className={j.late ? "" : "muted"}>
                    {j.late
                      ? <span className="tag" data-tone="danger"><i className="dot" />{j.etd ?? "—"}</span>
                      : (j.etd ?? "—")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* chart — inline SVG so it themes off the same tokens                 */
/* ------------------------------------------------------------------ */

function TrendChart({ data }: { data: { label: string; cut: number }[] }) {
  const W = 900;
  const H = 148;
  const padB = 20;
  if (data.length < 2) return <p className="panel__note">Not enough weeks of data yet.</p>;

  const max = Math.max(...data.map((d) => d.cut)) || 1;
  const x = (i: number) => (i / (data.length - 1)) * (W - 8) + 4;
  const y = (v: number) => H - padB - (v / max) * (H - padB - 10);

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.cut).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${H - padB} L${x(0).toFixed(1)},${H - padB} Z`;

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Weekly cut quantity">
      <defs>
        <linearGradient id="labgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line className="chart__grid" x1="0" y1={H - padB} x2={W} y2={H - padB} />
      <path className="chart__area" d={area} />
      <path className="chart__line" d={line} />
      {data.map((d, i) => (
        <circle key={d.label} className="chart__dot" cx={x(i)} cy={y(d.cut)} r="3" />
      ))}
      {data.map((d, i) => (
        <text key={`l-${d.label}`} className="chart__lbl" x={x(i)} y={H - 5} textAnchor="middle">
          {d.label}
        </text>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* detail sheet                                                        */
/* ------------------------------------------------------------------ */

function JobSheet({ job, onClose }: { job: LabData["jobs"][number] | null; onClose: () => void }) {
  // keep the last job while closing so the exit animation has content to animate
  const last = useRef(job);
  if (job) last.current = job;
  const j = job ?? last.current;

  const fill = j && j.cutQty > 0 ? j.dispatchedQty / j.cutQty : 0;

  return (
    <aside className="sheet" data-open={job ? "true" : "false"} aria-hidden={!job}>
      {j && (
        <>
          <header className="sheet__head">
            <span className="sheet__title">{j.siNo}</span>
            <span className="tag" data-tone="accent">{j.stage}</span>
            <span style={{ marginLeft: "auto" }} />
            <button className="btn btn--ghost" onClick={onClose} aria-label="Close">
              <X size={15} strokeWidth={2.2} />
            </button>
          </header>

          <div className="sheet__body">
            <div>
              <div className="kpi__label">Item</div>
              <div style={{ marginTop: 4, fontSize: 15, fontWeight: 650, letterSpacing: "-0.02em" }}>{j.item}</div>
            </div>

            <div>
              <div className="kpi__label">Received against cut</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <span className="bar" style={{ flex: 1 }}>
                  <i className="bar__fill" style={{ width: `${Math.min(100, fill * 100)}%` }} />
                </span>
                <b style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{pct(fill)}</b>
              </div>
            </div>

            <dl className="deflist">
              <dt>Vendor</dt><dd>{j.vendor}</dd>
              <dt>Cut qty</dt><dd>{num(j.cutQty)}</dd>
              <dt>Received</dt><dd>{num(j.dispatchedQty)}</dd>
              <dt>Balance</dt><dd>{num(j.cutQty - j.dispatchedQty)}</dd>
              <dt>Planned ETD</dt><dd>{j.etd ?? "—"}</dd>
            </dl>

            {j.late && (
              <p className="tag" data-tone="danger" style={{ alignSelf: "flex-start" }}>
                <i className="dot" /> Past planned ETD
              </p>
            )}
          </div>

          <footer className="sheet__foot">
            <button className="btn btn--primary" style={{ flex: 1, justifyContent: "center" }}>Open job card</button>
            <button className="btn" onClick={onClose}>Close</button>
          </footer>
        </>
      )}
    </aside>
  );
}
