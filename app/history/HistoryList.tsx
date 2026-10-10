"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BandPill, ButtonLink, Button } from "@/components/ui";
import { getHistory } from "@/lib/data";
import { clearAll, deleteBundle } from "@/lib/storage";
import type { HistoryItem } from "@/lib/types";

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Real history from this device, newest first. Reads storage after mount, so it shows a skeleton first. */
export function HistoryList() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    getHistory().then((h) => alive && setItems(h));
    return () => {
      alive = false;
    };
  }, []);

  const refresh = () => getHistory().then(setItems);
  const remove = (id: string) => {
    deleteBundle(id);
    void refresh();
  };
  const wipe = () => {
    clearAll();
    setConfirming(false);
    void refresh();
  };

  if (items === null) {
    return (
      <ul aria-busy="true" className="space-y-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-[92px] animate-pulse rounded-[16px] border border-v-border bg-v-card" />
        ))}
      </ul>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <h2 className="text-2xl font-extrabold text-v-text">No CSS practice essays yet</h2>
        <p className="mx-auto mt-3 max-w-md text-v-text-secondary">Upload a photo of a handwritten CSS practice essay and your first report will appear here. Reports are kept in this browser only.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/new">Upload a CSS essay</ButtonLink>
          <ButtonLink href="/report/example" variant="secondary" arrow={false}>Open the sample report</ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it.id} className="flex items-stretch gap-2">
            <Link
              href={`/report/${encodeURIComponent(it.id)}`}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] border border-v-border bg-v-card p-5 transition-colors hover:border-v-border-strong"
              style={{ boxShadow: "var(--v-elev-1)" }}
            >
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-[17px] font-bold leading-tight text-v-text">{it.topic}</p>
                <p className="mt-1 font-data text-[11px] uppercase tracking-[0.12em] text-v-text-muted">
                  {fmt.format(new Date(it.analysedAt))}
                  {it.isExample ? " · Example" : ""}
                </p>
              </div>
              <BandPill band={it.verdict} small />
              <span className="font-data text-[18px] font-bold text-v-text">
                {it.overallScore.toFixed(1)}
                <span className="text-[11px] font-medium text-v-text-muted"> / {it.overallOutOf}</span>
              </span>
              <span className="text-[13px] font-semibold text-v-accent-text">Open report →</span>
            </Link>
            <button
              type="button"
              onClick={() => remove(it.id)}
              aria-label={`Delete the report on ${it.topic}`}
              className="grid min-h-[44px] w-11 shrink-0 place-items-center self-center rounded-full border border-v-border text-v-text-muted transition-colors hover:border-v-alert hover:text-v-alert-text"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {confirming ? (
          <div role="alertdialog" aria-label="Clear all reports" className="flex flex-wrap items-center gap-3 rounded-[12px] border border-v-alert bg-v-alert-wash px-4 py-3">
            <p className="text-sm font-semibold text-v-alert-text">Delete all {items.length} saved report{items.length === 1 ? "" : "s"} from this device? This cannot be undone.</p>
            <Button variant="secondary" onClick={wipe}>Delete all</Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)}>Clear all</Button>
        )}
      </div>
      <p className="mt-4 text-[12.5px] text-v-text-muted">Reports are saved in this browser only, up to 20. Your photos are never saved.</p>
    </div>
  );
}
