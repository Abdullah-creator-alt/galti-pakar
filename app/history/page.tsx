import Link from "next/link";
import { AppShell } from "@/components/Shells";
import { BandPill, ButtonLink, Container, Eyebrow } from "@/components/ui";
import { getHistory } from "@/lib/data";

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function HistoryPage() {
  const items = (await getHistory()).sort((a, b) => b.analysedAt.localeCompare(a.analysedAt));
  return (
    <AppShell>
      <section className="border-b border-v-border" style={{ background: "var(--v-bg-field)" }}>
        <Container className="pb-14 pt-16 lg:pb-16 lg:pt-20">
          <Eyebrow>My essays</Eyebrow>
          <h1 className="mt-4 text-[clamp(34px,4.4vw,56px)] font-extrabold leading-[1.08] text-v-text">Your practice essays</h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-v-text-secondary">Newest first. Open any report to see where marks were won and lost.</p>
        </Container>
      </section>
      <main className="mx-auto max-w-[760px] px-4 pb-24 pt-14 sm:px-8">
        {items.length === 0 ? (
          <div className="py-16 text-center">
            <h2 className="text-2xl font-extrabold text-v-text">No essays yet</h2>
            <p className="mx-auto mt-3 max-w-md text-v-text-secondary">Upload a photo of a handwritten practice essay and your first report will appear here.</p>
            <div className="mt-6"><ButtonLink href="/new">Upload an essay</ButtonLink></div>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((it) => (
              <li key={it.id}>
                <Link
                  href={`/report/${it.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] border border-v-border bg-v-card p-5 transition-colors hover:border-v-border-strong"
                  style={{ boxShadow: "var(--v-elev-1)" }}
                >
                  <div className="min-w-0 flex-1 basis-60">
                    <p className="text-[17px] font-bold leading-tight text-v-text">{it.topic}</p>
                    <p className="mt-1 font-data text-[11px] uppercase tracking-[0.12em] text-v-text-muted">
                      {fmt.format(new Date(it.analysedAt))}{it.isExample ? " · Example" : ""}
                    </p>
                  </div>
                  <BandPill band={it.verdict} small />
                  <span className="font-data text-[18px] font-bold text-v-text">{it.overallScore.toFixed(1)}<span className="text-[11px] font-medium text-v-text-muted"> / {it.overallOutOf}</span></span>
                  <span className="text-[13px] font-semibold text-v-accent-text">Open report →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-[12.5px] text-v-text-muted">These entries are example data, not analyses of your essays.</p>
      </main>
    </AppShell>
  );
}
