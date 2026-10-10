import { AppShell } from "@/components/Shells";
import { ButtonLink, Container, Eyebrow, LIMITATION_TEXT, LimitationNote } from "@/components/ui";

export default function Home() {
  return (
    <AppShell>
      <section style={{ background: "var(--v-bg-field)" }} className="border-b border-v-border">
        <Container className="pb-20 pt-16 lg:pb-28 lg:pt-24">
          <div className="max-w-3xl">
            <div className="v-enter-fade"><Eyebrow>CSS essay feedback</Eyebrow></div>
            <h1 className="v-enter-rise mt-4 text-[clamp(40px,7vw,76px)] font-bold leading-[0.95] text-v-text">
              Find out where your essay loses marks.
              <span className="block bg-gradient-to-r from-v-accent-text to-v-accent bg-clip-text text-transparent">Before the examiner does.</span>
            </h1>
            <p className="v-enter-rise mt-6 max-w-2xl text-[17px] leading-relaxed text-v-text-secondary" style={{ animationDelay: "90ms" }}>
              Photograph a handwritten practice essay. Galti Pakar reads it, marks strong and weak passages, shows where you drift off topic, and ranks the three fixes that matter most.
            </p>
            <div className="v-enter-fade mt-8 flex flex-wrap gap-3" style={{ animationDelay: "180ms" }}>
              <ButtonLink href="/new">Upload an essay</ButtonLink>
              <ButtonLink href="/report/example" variant="secondary" arrow={false}>See an example report</ButtonLink>
            </div>
          </div>
        </Container>
      </section>
      <Container className="py-16">
        <ul className="grid gap-6 md:grid-cols-3">
          {[
            ["Where exactly", "Every passage is marked strong, weak or off-topic, with the reason one tap away."],
            ["Why", "Seven rubric dimensions, scored by several AI examiners, with disagreement shown rather than hidden."],
            ["What to fix", "Three ranked fixes and one paragraph rewritten, so you know what to do tonight."],
          ].map(([t, b]) => (
            <li key={t} className="rounded-[18px] border border-v-border bg-v-card p-7" style={{ boxShadow: "var(--v-elev-2)" }}>
              <h2 className="text-[20px] font-bold leading-tight text-v-text">{t}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-v-text-secondary">{b}</p>
            </li>
          ))}
        </ul>
        <div className="mt-10 max-w-3xl"><LimitationNote text={LIMITATION_TEXT} /></div>
      </Container>
    </AppShell>
  );
}
