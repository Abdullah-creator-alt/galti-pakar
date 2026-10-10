import { AppShell } from "@/components/Shells";
import { ButtonLink, Container, Eyebrow, LIMITATION_TEXT, LimitationNote } from "@/components/ui";

/**
 * The hero shows the product's own mechanism instead of describing it: a marked-up page of practice writing, drawn with
 * the same highlight styles the report uses. It is a labelled sample, not an analysis of anyone's essay.
 */
function SamplePage() {
  return (
    <figure className="v-enter-rise relative mx-auto w-full max-w-[460px] lg:mx-0 lg:justify-self-end" style={{ animationDelay: "140ms" }}>
      <div
        className="rounded-[14px] border border-v-border bg-v-card px-6 pb-6 pt-5 lg:-rotate-[1.2deg]"
        style={{ boxShadow: "var(--v-elev-3)" }}
      >
        <p className="font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-text-muted">Sample passage · not a real analysis</p>
        <p className="mt-3 text-[17px] leading-[34px] text-v-text" style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 33px, var(--v-border) 33px, var(--v-border) 34px)" }}>
          <span className="hl hl-weak">Pakistan faces many problems, and water is one of them.</span>{" "}
          <span className="hl hl-strong">The Indus Basin Irrigation System loses roughly a third of its water before it reaches a field.</span>{" "}
          <span className="hl hl-offtopic">Everybody knows something must be done.</span>
        </p>
      </div>
      <figcaption className="relative z-10 -mt-4 ml-4 max-w-[400px] rounded-[12px] border border-v-alert bg-v-surface px-4 py-3 lg:ml-10" style={{ boxShadow: "var(--v-elev-2)" }}>
        <p className="font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-alert-text">Off-topic or unsupported</p>
        <p className="mt-1 text-[14px] leading-snug text-v-text-secondary">A claim with no sentence in the essay that backs it up. Tap any marked passage to see the reason and how it was found.</p>
      </figcaption>
      <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-v-text-secondary" aria-label="What the marks mean">
        <li><span className="hl hl-strong">Strong</span></li>
        <li><span className="hl hl-weak">Weak or generic</span></li>
        <li><span className="hl hl-offtopic">Off-topic or unsupported</span></li>
      </ul>
    </figure>
  );
}

export default function Home() {
  return (
    <AppShell>
      <section style={{ background: "var(--v-bg-field)" }} className="border-b border-v-border">
        <Container className="grid items-center gap-12 pb-20 pt-16 lg:grid-cols-[1.15fr_1fr] lg:gap-10 lg:pb-28 lg:pt-24">
          <div>
            <div className="v-enter-fade"><Eyebrow>CSS English Essay practice</Eyebrow></div>
            <h1 className="v-enter-rise mt-4 text-[clamp(40px,6vw,68px)] font-bold leading-[0.98] text-v-text">
              Find out where your CSS essay loses marks.
              <span className="block bg-gradient-to-r from-v-accent-text to-v-accent bg-clip-text text-transparent">Before the examiner does.</span>
            </h1>
            <p className="v-enter-rise mt-6 max-w-xl text-[17px] leading-relaxed text-v-text-secondary" style={{ animationDelay: "90ms" }}>
              Photograph your handwritten CSS practice essay, outline included. Galti Pakar reads it, marks strong and weak passages, shows where you drift off the topic you chose, and ranks the three fixes that matter most before your next practice paper.
            </p>
            <div className="v-enter-fade mt-8 flex flex-wrap gap-3" style={{ animationDelay: "180ms" }}>
              <ButtonLink href="/new">Upload a CSS essay</ButtonLink>
              <ButtonLink href="/report/example" variant="secondary" arrow={false}>See an example report</ButtonLink>
            </div>
          </div>
          <SamplePage />
        </Container>
      </section>
      <Container className="py-16">
        <ul className="grid gap-6 md:grid-cols-3">
          {[
            ["Where exactly", "Every passage is marked strong, weak or off-topic, with the reason one tap away."],
            ["Why", "Seven practice-rubric dimensions (thesis, outline, argument, evidence, counter-argument, coherence and language), scored by several AI examiner runs, with disagreement shown rather than hidden."],
            ["What to fix", "Three ranked fixes and one model paragraph, so you know what to work on before your next CSS practice essay."],
          ].map(([t, b]) => (
            <li key={t} className="rounded-[18px] border border-v-border bg-v-card p-7" style={{ boxShadow: "var(--v-elev-2)" }}>
              <h2 className="text-[20px] font-bold leading-tight text-v-text">{t}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-v-text-secondary">{b}</p>
            </li>
          ))}
        </ul>
        <div className="mt-10"><LimitationNote text={LIMITATION_TEXT} /></div>
      </Container>
    </AppShell>
  );
}
