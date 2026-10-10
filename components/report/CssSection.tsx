import type { CssCriterionRow, CssCriterionStatus, CssInsight, CssProfileInfo } from "@/lib/types.extras";

/**
 * "For the CSS English Essay": structural signals read through the CSS profile. It shows where to look and what the
 * analysis could not look at. It never shows a mark, score or grade, and "nothing flagged" is deliberately neutral
 * (never green), because a missing signal does not mean a part is strong.
 */

const STATUS: Record<CssCriterionStatus, { label: string; cls: string; mark: string }> = {
  signals: { label: "Signals to check", cls: "border border-v-flag/40 bg-v-flag-wash text-v-flag-text", mark: "●" },
  none_flagged: { label: "Nothing flagged", cls: "border border-v-border text-v-text-secondary", mark: "–" },
  nothing_to_check: { label: "Nothing to check", cls: "border border-v-border text-v-text-secondary", mark: "–" },
  not_assessed: { label: "Not assessed here", cls: "border border-dashed border-v-border-strong text-v-text-muted", mark: "–" },
};

const label = (pid: string) => pid.replace(/^p/i, "P");

function ParagraphLinks({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2">
      <span className="font-data text-[10.5px] font-bold uppercase tracking-[0.12em] text-v-text-muted">See</span>
      {ids.map((id) => (
        <a
          key={id}
          href={`#${id}`}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-v-border px-3 font-data text-[12px] font-semibold text-v-accent-text underline-offset-4 hover:border-v-border-strong hover:underline"
          aria-label={`Go to paragraph ${label(id).slice(1)} in your essay`}
        >
          {label(id)}
        </a>
      ))}
    </p>
  );
}

function InsightCard({ insight }: { insight: CssInsight }) {
  return (
    <li className="min-w-0 rounded-[12px] border border-v-border bg-v-card p-4">
      <h3 className="break-words text-[15.5px] font-bold leading-snug text-v-text">{insight.headline}</h3>
      <p className="mt-1.5 break-words text-[13.5px] leading-relaxed text-v-text-secondary">{insight.detail}</p>
      <ParagraphLinks ids={insight.paragraphIds} />
    </li>
  );
}

function OriginBadge({ origin }: { origin: CssCriterionRow["origin"] }) {
  const official = origin === "official_requirement" || origin === "official_guidance";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 font-data text-[10px] font-bold uppercase tracking-[0.1em] ${
        official ? "border border-v-accent-text/50 bg-v-accent-wash text-v-accent-text" : "border border-v-border text-v-text-muted"
      }`}
    >
      {official ? "FPSC syllabus" : "Inferred best practice"}
    </span>
  );
}

function CriterionRow({ c }: { c: CssCriterionRow }) {
  const st = STATUS[c.status];
  return (
    <li className="min-w-0 rounded-[12px] border border-v-border bg-v-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-data text-[10.5px] font-bold tracking-[0.12em] text-v-accent-text">{c.id.replace("CSS-ESSAY-", "")}</span>
        <OriginBadge origin={c.origin} />
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${st.cls}`}>
          <span aria-hidden>{st.mark}</span>
          {st.label}
        </span>
      </div>
      <h3 className="mt-2 break-words text-[15.5px] font-bold leading-snug text-v-text">{c.title}</h3>

      {c.observations.length > 0 && (
        <ul className="mt-2 space-y-2">
          {c.observations.map((o, i) => (
            <li key={i} className="break-words text-[13.5px] leading-relaxed text-v-text-secondary">
              {o.text}
              <ParagraphLinks ids={o.paragraphIds} />
            </li>
          ))}
        </ul>
      )}
      {c.note && <p className="mt-2 break-words text-[13px] leading-relaxed text-v-text-muted">{c.note}</p>}

      {c.sourceQuote && (
        <blockquote className="mt-3 border-l-2 border-v-accent-text/60 pl-3 text-[13px] leading-relaxed text-v-text-secondary">
          <p className="break-words">“{c.sourceQuote}”</p>
          {c.sourceLocator && <p className="mt-1 break-words text-[12px] text-v-text-muted">FPSC syllabus, {c.sourceLocator}</p>}
        </blockquote>
      )}

      {c.limitations && (
        <details className="mt-3">
          <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[12.5px] font-semibold text-v-accent-text underline underline-offset-4">What this cannot show</summary>
          <p className="break-words pb-1 text-[13px] leading-relaxed text-v-text-secondary">{c.limitations}</p>
        </details>
      )}
    </li>
  );
}

export function CssSection({ info }: { info: CssProfileInfo }) {
  const signals = info.criteria.filter((c) => c.status === "signals").length;
  return (
    <div>
      <p className="max-w-3xl text-[15px] leading-relaxed text-v-text-secondary">
        These are structural signals from your essay, read through the CSS English Essay lens. They show places to look; the examiner decides. No marks, score or grade come from this section.
      </p>

      {info.insights.length > 0 && (
        <>
          <h3 className="mt-6 font-data text-[11px] font-bold uppercase tracking-[0.15em] text-v-text-muted">What stands out</h3>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {info.insights.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-8 font-data text-[11px] font-bold uppercase tracking-[0.15em] text-v-text-muted">
        Criteria checked ({signals} with signals of {info.criteria.length})
      </h3>
      <ul className="mt-3 grid gap-3">
        {info.criteria.map((c) => (
          <CriterionRow key={c.id} c={c} />
        ))}
      </ul>

      <div className="mt-6 rounded-[12px] border border-v-border bg-v-surface p-4">
        <p className="font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-text-muted">Read this first</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          {info.caveats.map((t, i) => (
            <li key={i} className="break-words text-[13.5px] leading-relaxed text-v-text-secondary">
              {t}
            </li>
          ))}
        </ul>
        <p className="mt-3 break-words text-[12.5px] leading-relaxed text-v-text-muted">
          Source:{" "}
          <a href={info.source.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-v-accent-text underline underline-offset-4">
            {info.source.title}
          </a>
          {info.source.locator ? `, ${info.source.locator}` : ""}
          {info.source.retrievedOn ? `. Checked ${info.source.retrievedOn}.` : "."} Profile {info.profileId} v{info.profileVersion}.
        </p>
      </div>
    </div>
  );
}
