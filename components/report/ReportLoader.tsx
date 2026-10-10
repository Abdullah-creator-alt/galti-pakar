"use client";

import { useEffect, useState } from "react";
import { ReportView } from "@/components/report/ReportView";
import { ButtonLink } from "@/components/ui";
import { getBundle, type LoadedBundle } from "@/lib/data";

type State = { status: "loading" } | { status: "missing" } | { status: "ready"; loaded: LoadedBundle };

/** Skeleton sized like the real header and summary strip, so the report does not shift when it appears. */
function Skeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="border-b border-v-border" style={{ background: "var(--v-bg-field)" }}>
        <div className="mx-auto max-w-[1120px] px-4 pb-14 pt-12 sm:px-8 lg:pt-16">
          <div className="h-3 w-24 animate-pulse rounded bg-v-border" />
          <div className="mt-5 h-12 w-3/4 animate-pulse rounded bg-v-border" />
          <div className="mt-5 h-8 w-48 animate-pulse rounded-full bg-v-border" />
          <p className="mt-6 font-data text-[11px] uppercase tracking-[0.2em] text-v-text-muted">Loading report</p>
        </div>
      </div>
      <div className="mx-auto max-w-[1120px] px-4 pt-10 sm:px-8">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-v-border bg-v-border sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[88px] animate-pulse bg-v-surface" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ReportLoader({ id }: { id: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    getBundle(id)
      .then((loaded) => alive && setState(loaded ? { status: "ready", loaded } : { status: "missing" }))
      .catch(() => alive && setState({ status: "missing" }));
    return () => {
      alive = false;
    };
  }, [id]);

  if (state.status === "loading") return <Skeleton />;
  if (state.status === "missing") {
    return (
      <main className="mx-auto flex min-h-[60dvh] max-w-[560px] flex-col items-center justify-center px-5 py-16 text-center">
        <h1 className="text-[clamp(26px,5vw,34px)] font-extrabold leading-[1.1] text-v-text">This report isn&apos;t on this device</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-v-text-secondary">
          Reports are kept in the browser that analysed them, and this one is not here. It may have been cleared, or opened on another device.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/new">Analyse an essay</ButtonLink>
          <ButtonLink href="/report/example" variant="secondary" arrow={false}>Open the sample report</ButtonLink>
        </div>
      </main>
    );
  }
  return <ReportView bundle={state.loaded.bundle} source={state.loaded.source} />;
}
