import Link from "next/link";
import type { ReactNode } from "react";
import { Container, Eyebrow, Logo, ThemeToggle } from "./ui";

const STEPS = ["Upload", "Analyse", "Report"];

/** Slim focused-flow header: wordmark, step rail, quiet exit. */
export function FlowShell({ step, children, width = 620 }: { step: 1 | 2 | 3; children: ReactNode; width?: number }) {
  return (
    <div className="min-h-[100dvh]" style={{ background: "var(--v-bg-field)" }}>
      <header className="sticky top-0 z-20 border-b border-v-border bg-v-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[64px] max-w-[1100px] items-center justify-between gap-3 px-5">
          <Logo />
          <ol className="hidden items-center gap-2 sm:flex" aria-label="Progress">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const done = n < step;
              const active = n === step;
              return (
                <li key={label} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-full font-data text-[11px] font-bold ${
                      active
                        ? "bg-v-accent-strong text-v-on-accent"
                        : done
                          ? "border border-v-accent-text text-v-accent-text"
                          : "border border-v-border-strong text-v-text-muted"
                    }`}
                  >
                    {done ? "✓" : n}
                  </span>
                  <span className={`font-data text-[11px] font-semibold uppercase tracking-[0.12em] ${active ? "text-v-text" : "text-v-text-muted"}`}>
                    {label}
                  </span>
                  {n < STEPS.length && <span className="h-px w-6 bg-v-border-strong" aria-hidden />}
                </li>
              );
            })}
          </ol>
          <p className="font-data text-[11px] font-semibold uppercase tracking-[0.12em] text-v-text-muted sm:hidden">
            Step {step} of 3
          </p>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/" className="inline-flex min-h-[44px] items-center px-2 text-[13px] font-semibold text-v-text-muted hover:text-v-text">
              Exit
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto px-5 py-12 sm:py-16" style={{ maxWidth: width }}>
        {children}
      </main>
    </div>
  );
}

export function FlowHeader({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <div className="mb-8">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="mt-3 text-[clamp(28px,5vw,38px)] font-extrabold leading-[1.1] text-v-text">{title}</h1>
      {lead && <p className="mt-3 text-[16px] leading-relaxed text-v-text-secondary">{lead}</p>}
    </div>
  );
}

/** Solid header for app pages (history, report). */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh]">
      <header className="no-print sticky top-0 z-20 border-b border-v-border bg-v-bg/85 backdrop-blur-xl">
        <Container className="flex h-[64px] items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-1 sm:gap-3" aria-label="Main">
            <Link href="/how-it-works" className="hidden min-h-[44px] items-center whitespace-nowrap px-3 text-[13px] font-semibold text-v-text-secondary hover:text-v-text sm:inline-flex">
              How it works
            </Link>
            <Link href="/history" className="inline-flex min-h-[44px] items-center whitespace-nowrap px-2 text-[13px] font-semibold text-v-text-secondary hover:text-v-text sm:px-3">
              My essays
            </Link>
            <ThemeToggle />
            <Link
              href="/new"
              className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full bg-[#0a0a0a] px-4 sm:px-5 text-[13px] font-semibold text-white  border border-v-border-strong"
              style={{ color: "#fff" }}
            >
              New essay
            </Link>
          </nav>
        </Container>
      </header>
      {children}
    </div>
  );
}
