"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { BAND_LABEL } from "@/lib/derive";
import type { Band } from "@/lib/types";

/* ---------- layout ---------- */

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto w-full max-w-[1440px] px-6 md:px-10 lg:px-16 2xl:max-w-[1600px] ${className}`}>
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-v-accent-text">{children}</p>;
}

export function SectionRule({ title, id }: { title: string; id?: string }) {
  return (
    <div id={id} className="mb-4 mt-12 flex scroll-mt-24 items-center gap-3">
      <span className="font-data text-[11px] font-bold uppercase tracking-[0.15em] text-v-accent-text">{title}</span>
      <span className="h-px flex-1 bg-v-border" />
    </div>
  );
}

/* ---------- buttons ---------- */

const base =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60";
const variants = {
  primary: "v-btn-primary bg-v-accent-strong text-v-on-accent",
  secondary: "v-btn-ghost border border-v-border-strong bg-v-surface text-v-text",
};

export function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  children,
  arrow = true,
  className = "",
}: {
  href: string;
  variant?: keyof typeof variants;
  children: ReactNode;
  arrow?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`${base} ${variants[variant]} ${className}`}
      style={variant === "primary" ? { boxShadow: "var(--v-glow-cta)" } : undefined}
    >
      {children}
      {arrow && <ArrowIcon />}
    </Link>
  );
}

export function Button({
  variant = "secondary",
  className = "",
  children,
  ...rest
}: { variant?: keyof typeof variants } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`${base} ${variants[variant]} ${className}`}
      style={variant === "primary" && !rest.disabled ? { boxShadow: "var(--v-glow-cta)" } : undefined}
    >
      {children}
    </button>
  );
}

/* ---------- surfaces ---------- */

export function Card({
  children,
  hover = true,
  className = "",
}: {
  children: ReactNode;
  hover?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[18px] border border-v-border bg-v-card p-7 ${hover ? "v-card" : ""} ${className}`}
      style={{ boxShadow: "var(--v-elev-2)" }}
    >
      {children}
    </div>
  );
}

type ToneRail = "good" | "flag" | "alert" | "neutral";
const rail: Record<ToneRail, string> = {
  good: "border-l-v-good",
  flag: "border-l-v-flag",
  alert: "border-l-v-alert",
  neutral: "border-l-v-border-strong",
};

export function ToneCard({ title, tone, children }: { title: ReactNode; tone: ToneRail; children: ReactNode }) {
  return (
    <div className={`rounded-xl border border-l-4 border-v-border bg-v-surface p-4 ${rail[tone]}`}>
      <p className="mb-2 font-data text-[11px] font-bold uppercase tracking-[0.14em] text-v-text">{title}</p>
      <div className="text-sm text-v-text-secondary">{children}</div>
    </div>
  );
}

export function LimitationNote({ text }: { text: string }) {
  return (
    <div className="rounded-[14px] border border-v-border bg-v-surface p-6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-v-text-muted">Important limitation</p>
      <p className="mt-3 text-sm leading-relaxed text-v-text-secondary">{text}</p>
    </div>
  );
}

/** Placeholder wording until the product owner approves final text. */
export const LIMITATION_TEXT =
  "Galti Pakar gives AI-assisted practice feedback. It is not an official examiner's mark and does not predict your result in the CSS examination. Use it to find weak points, not as a final score.";

export function ExampleBanner() {
  const [open, setOpen] = useState(true);
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print mb-4 min-h-[44px] font-data text-[11px] uppercase tracking-[0.14em] text-v-flag-text underline underline-offset-4"
      >
        Show example-data notice
      </button>
    );
  return (
    <div role="note" className="mb-6 flex items-start gap-3 rounded-[10px] border border-dashed border-v-flag bg-v-flag-wash px-4 py-3">
      <p className="flex-1 text-sm leading-snug text-v-flag-text">
        <strong className="font-bold">Example report.</strong> These scores and highlights are sample data, not an analysis of your essay.
      </p>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Dismiss notice"
        className="no-print -my-2 -mr-2 grid h-11 w-11 shrink-0 place-items-center text-v-flag-text"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

/* ---------- state icons: tick | clock | dash ---------- */

export type State = "ok" | "partial" | "absent";
const stateColor: Record<State, string> = {
  ok: "text-v-accent-text",
  partial: "text-v-flag-text",
  absent: "text-v-text-muted",
};
export const stateText = stateColor;

export function StateIcon({ state, size = 14 }: { state: State; size?: number }) {
  const label = state === "ok" ? "Complete" : state === "partial" ? "Needs a look" : "Not assessed";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={stateColor[state]} role="img" aria-label={label}>
      <circle cx="12" cy="12" r="10" />
      {state === "ok" && <path d="M7.5 12.5l3 3 6-7" />}
      {state === "partial" && <path d="M12 7v5l3 2" />}
      {state === "absent" && <path d="M8 12h8" />}
    </svg>
  );
}

/* ---------- verdict / band ---------- */

export const bandStyle: Record<Band, { pill: string; dot: string; text: string; fill: string }> = {
  competitive: { pill: "bg-v-good-wash text-v-good-text", dot: "bg-v-good", text: "text-v-good-text", fill: "bg-v-good" },
  borderline: { pill: "bg-v-flag-wash text-v-flag-text border border-v-flag/40", dot: "bg-v-flag", text: "text-v-flag-text", fill: "bg-v-flag" },
  "below-pass": { pill: "bg-v-alert-wash text-v-alert-text", dot: "bg-v-alert", text: "text-v-alert-text", fill: "bg-v-alert" },
};

export function BandPill({ band, label, small }: { band: Band; label?: string; small?: boolean }) {
  const s = bandStyle[band];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full font-data font-bold uppercase ${s.pill} ${
        small ? "px-3 py-1 text-[10px] tracking-[0.12em]" : "px-4 py-2 text-[11px] tracking-[0.14em]"
      }`}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} aria-hidden />
      {label ?? BAND_LABEL[band]}
    </span>
  );
}

/* ---------- brand / chrome ---------- */

export function Logo() {
  return (
    <Link href="/" className="inline-flex min-h-[44px] items-center whitespace-nowrap text-[17px] font-extrabold uppercase tracking-tight text-v-text">
      <span className="text-v-accent-text">G</span>ALTI PAKAR
    </Link>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("gp-theme", next);
    } catch {
      /* storage can be blocked */
    }
    setTheme(next);
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="no-print grid h-11 w-11 place-items-center rounded-full border border-v-border text-v-text transition-colors hover:border-v-border-strong"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        )}
      </svg>
    </button>
  );
}

export function Reveal({
  children,
  variant = "v-reveal",
  className = "",
}: {
  children: ReactNode;
  variant?: "v-reveal" | "v-reveal-left" | "v-reveal-scale";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`${variant} ${shown ? "is-visible" : ""} ${className}`}>
      {children}
    </div>
  );
}
