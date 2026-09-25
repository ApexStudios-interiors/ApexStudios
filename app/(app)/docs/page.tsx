import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { td, th } from "@/components/ui/table";
import { FLOWS, GLOSSARY, JOB_SCHEDULE, LEGEND, ROLE_STORIES, WHERE, type ChainStep } from "./content";

/**
 * In-app help. Static content, no data fetching: everything it says lives in
 * `./content.tsx`. Visible to every role — the app shell has already required
 * a signed-in, active session, and nothing here is role-specific data.
 */
export const metadata = { title: "Docs — Apex Projects" };

const TOC: { href: string; label: string }[] = [
  { href: "#glossary", label: "Glossary" },
  { href: "#roles", label: "Who does what" },
  { href: "#flows", label: "How things flow" },
  { href: "#where", label: "Where to find things" },
];

export default function DocsPage() {
  return (
    <div className="max-w-[960px]">
      <div className="mb-5">
        <h1 className="text-[26px] font-bold tracking-tight">Docs</h1>
        <p className="mt-1 text-muted-foreground text-[13.5px]">
          What the words mean, who does what, and how each thing moves from start to finish.
        </p>
      </div>

      <nav aria-label="On this page" className="flex flex-wrap gap-x-4 gap-y-1 mb-6 text-[13.5px]">
        {TOC.map((t) => (
          <a key={t.href} href={t.href} className="font-medium text-foreground underline underline-offset-4 hover:opacity-70">
            {t.label}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-6">
        {/* ── 1. Glossary ─────────────────────────────────────────────── */}
        <Section id="glossary" title="Glossary">
          <div className="flex flex-col gap-5 p-5">
            {GLOSSARY.map((group) => (
              <div key={group.id} id={group.id}>
                <h3 className="text-[13.5px] font-semibold mb-2">{group.title}</h3>
                <table className="w-full border-collapse [&>tbody>tr:last-child>td]:border-b-0">
                  <thead>
                    <tr>
                      <th className={`${th} w-[34%] sm:w-[26%]`}>Term</th>
                      <th className={th}>Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.entries.map((e) => (
                      <tr key={e.term}>
                        <td className={`${td} font-semibold align-top`}>{e.term}</td>
                        <td className={`${td} text-[13.5px] align-top`}>{e.definition}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <div id="glossary-badges">
              <h3 className="text-[13.5px] font-semibold mb-2">Other badges you will meet</h3>
              <table className="w-full border-collapse [&>tbody>tr:last-child>td]:border-b-0">
                <thead>
                  <tr>
                    <th className={`${th} w-[34%] sm:w-[26%]`}>Where</th>
                    <th className={th}>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {LEGEND.map((l) => (
                    <tr key={l.label}>
                      <td className={`${td} font-semibold align-top`}>{l.label}</td>
                      <td className={`${td} text-[13.5px] align-top`}>
                        <div className="flex flex-wrap gap-1.5 mb-1.5">{l.badges}</div>
                        {l.meaning}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        {/* ── 2. Who does what ───────────────────────────────────────── */}
        <Section id="roles" title="Who does what">
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            {ROLE_STORIES.map((r) => (
              <div key={r.id} id={r.id} className="border border-border rounded-[10px] p-4">
                <h3 className="text-[13.5px] font-semibold mb-2">As {article(r.role)} {r.role} I can…</h3>
                <ul className="list-disc pl-5 text-[13.5px] flex flex-col gap-1">
                  {r.can.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground mt-4 mb-1.5">
                  I cannot
                </h4>
                <ul className="list-disc pl-5 text-[13.5px] text-muted-foreground flex flex-col gap-1">
                  {r.cannot.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        {/* ── 3. How things flow ─────────────────────────────────────── */}
        <Section id="flows" title="How things flow">
          <div className="flex flex-col divide-y divide-border">
            {FLOWS.map((f) => (
              <div key={f.id} id={f.id} className="p-5">
                <h3 className="text-[15px] font-semibold">{f.title}</h3>
                <p className="mt-1 text-[13.5px] text-muted-foreground">{f.purpose}</p>

                <Chain steps={f.chain} />
                {f.exits ? (
                  <div className="mt-2">
                    <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      Other exits
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {f.exits.map((e, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
                          {e.badge}
                          <span className="text-muted-foreground">{e.who}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <ol className="list-decimal pl-5 mt-4 text-[13.5px] flex flex-col gap-1.5">
                  {f.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>

                {f.notes ? (
                  <ul className="list-disc pl-5 mt-3 text-[13px] text-muted-foreground flex flex-col gap-1">
                    {f.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                ) : null}

                {f.id === "flow-billing" ? <BillArithmetic /> : null}
                {f.id === "flow-jobs" ? <JobSchedule /> : null}
              </div>
            ))}
          </div>
        </Section>

        {/* ── Where to find things ───────────────────────────────────── */}
        <Section id="where" title="Where to find things">
          <div className="p-5">
            <table className="w-full border-collapse [&>tbody>tr:last-child>td]:border-b-0">
              <thead>
                <tr>
                  <th className={`${th} w-[34%] sm:w-[22%]`}>Sidebar item</th>
                  <th className={`${th} hidden sm:table-cell`}>Who</th>
                  <th className={th}>What it is for</th>
                </tr>
              </thead>
              <tbody>
                {WHERE.map((w) => (
                  <tr key={w.item}>
                    <td className={`${td} font-semibold align-top`}>
                      {w.item}
                      <span className="block sm:hidden text-xs text-muted-foreground font-normal mt-0.5">{w.roles}</span>
                    </td>
                    <td className={`${td} hidden sm:table-cell align-top text-[13.5px] text-muted-foreground`}>{w.roles}</td>
                    <td className={`${td} text-[13.5px] align-top`}>{w.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}

// ── Local pieces ─────────────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-4">
      <CardHeader>
        <h2 className="text-[15px] font-bold">{title}</h2>
      </CardHeader>
      {children}
    </Card>
  );
}

/** The status chain: badge → badge → badge, each with who moves it there. */
function Chain({ steps }: { steps: ChainStep[] }) {
  return (
    <ol className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-2 sm:gap-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2 sm:max-w-[200px]">
          {i > 0 ? (
            <span aria-hidden="true" className="text-muted-foreground mt-0.5 sm:mt-0">
              →
            </span>
          ) : null}
          <div className="flex flex-col gap-1">
            {s.badge}
            <span className="text-[12px] text-muted-foreground leading-snug">{s.who}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** HLD §8.4, in the order the billing engine applies it. GST comes before retention. */
function BillArithmetic() {
  const rows: { label: string; formula: string }[] = [
    { label: "Gross", formula: "work value + material value" },
    { label: "Taxable value", formula: "gross − MAS recovery" },
    { label: "GST", formula: "taxable value × GST rate" },
    { label: "Invoice total", formula: "taxable value + GST" },
    { label: "Retention", formula: "taxable value × retention rate" },
    { label: "TDS", formula: "taxable value × TDS rate" },
    { label: "Net payable", formula: "invoice total − retention − TDS − advance recovery" },
  ];
  return (
    <div className="mt-4">
      <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
        How a bill is worked out
      </h4>
      <table className="w-full border-collapse [&>tbody>tr:last-child>td]:border-b-0">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className={`${td} py-2 font-semibold w-[34%] sm:w-[26%] align-top`}>{r.label}</td>
              <td className={`${td} py-2 text-[13.5px] tabular-nums align-top`}>= {r.formula}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[13px] text-muted-foreground">
        GST is charged on the full taxable value <b className="text-foreground">before</b> retention is taken off. Retention
        reduces what is payable now, not the tax. The percentages are copied onto the bill when it is created, so changing a
        project&apos;s rates later never changes an existing bill.
      </p>
    </div>
  );
}

function JobSchedule() {
  return (
    <div className="mt-4">
      <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">What runs when</h4>
      <table className="w-full border-collapse [&>tbody>tr:last-child>td]:border-b-0">
        <thead>
          <tr>
            <th className={th}>Job</th>
            <th className={th}>When</th>
            <th className={`${th} hidden sm:table-cell`}>What it does</th>
          </tr>
        </thead>
        <tbody>
          {JOB_SCHEDULE.map((j) => (
            <tr key={j.job}>
              <td className={`${td} py-2 font-semibold align-top`}>
                {j.job}
                <span className="block sm:hidden text-xs text-muted-foreground font-normal mt-0.5">{j.what}</span>
              </td>
              <td className={`${td} py-2 text-[13.5px] align-top whitespace-nowrap`}>{j.when}</td>
              <td className={`${td} py-2 hidden sm:table-cell text-[13.5px] align-top`}>{j.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function article(role: string): string {
  return /^[aeiou]/i.test(role) ? "an" : "a";
}
