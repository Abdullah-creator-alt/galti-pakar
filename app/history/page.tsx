import { AppShell } from "@/components/Shells";
import { Container, Eyebrow } from "@/components/ui";
import { HistoryList } from "./HistoryList";

export default function HistoryPage() {
  return (
    <AppShell>
      <section className="border-b border-v-border" style={{ background: "var(--v-bg-field)" }}>
        <Container className="pb-14 pt-16 lg:pb-16 lg:pt-20">
          <Eyebrow>My CSS essays</Eyebrow>
          <h1 className="mt-4 text-[clamp(34px,4.4vw,56px)] font-extrabold leading-[1.08] text-v-text">Your CSS practice essays</h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-v-text-secondary">Newest first. Open any report to see where marks were won and lost.</p>
        </Container>
      </section>
      <main className="mx-auto max-w-[760px] px-4 pb-24 pt-14 sm:px-8">
        <HistoryList />
      </main>
    </AppShell>
  );
}
