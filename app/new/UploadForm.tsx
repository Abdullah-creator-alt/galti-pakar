"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

const MAX_MB = 10;
const MAX_PAGES = 12;
const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/heic"];

const TOPICS = [
  "Climate change and Pakistan's economic future",
  "Water scarcity and food security",
  "Terrorism and the national narrative",
  "Youth unemployment in Pakistan",
  "Democracy and governance in developing states",
];

interface Page {
  id: string;
  name: string;
  url: string;
}

export function UploadForm() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const added: Page[] = [];
    let problem: string | null = null;
    for (const f of Array.from(list)) {
      if (!ACCEPT.includes(f.type)) {
        problem = `"${f.name}" is not a supported image. Use a JPEG, PNG, WebP or HEIC photo.`;
        continue;
      }
      if (f.size > MAX_MB * 1024 * 1024) {
        problem = `"${f.name}" is larger than ${MAX_MB} MB. Retake it at a lower resolution or crop the edges.`;
        continue;
      }
      if (pages.length + added.length >= MAX_PAGES) {
        problem = `You can add up to ${MAX_PAGES} pages. The extra photos were not added.`;
        break;
      }
      const url = URL.createObjectURL(f);
      urls.current.push(url);
      added.push({ id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`, name: f.name, url });
    }
    setError(problem);
    if (added.length) setPages((p) => [...p, ...added]);
  }

  function move(i: number, dir: -1 | 1) {
    setPages((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  const ready = topic.trim().length > 2 && pages.length > 0;
  const why = !topic.trim() && !pages.length ? "Add a topic and at least one photo to continue." : !topic.trim() ? "Add the essay topic to continue." : "Add at least one photo to continue.";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    router.push(`/analysing?topic=${encodeURIComponent(topic.trim())}&pages=${pages.length}`);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <div className="space-y-1.5">
        <label htmlFor="topic" className="text-[13.5px] font-semibold text-v-text">
          Essay topic
        </label>
        <input
          id="topic"
          list="topics"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Water scarcity and food security"
          autoComplete="off"
          aria-describedby="topic-hint"
          className="w-full rounded-[11px] border border-v-border bg-v-surface px-4 py-3 text-base text-v-text placeholder:text-v-text-muted transition-colors focus:border-v-accent focus:outline-none focus:ring-2 focus:ring-v-accent/25 sm:text-[15px]"
        />
        <datalist id="topics">
          {TOPICS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <p id="topic-hint" className="text-[12.5px] leading-snug text-v-text-muted">
          Type the topic you were given, or pick a past CSS topic below.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {TOPICS.slice(0, 3).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTopic(t)}
              className="min-h-[44px] rounded-full border border-v-border px-4 text-[13px] text-v-text-secondary transition-colors hover:border-v-border-strong"
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`rounded-[14px] border border-dashed border-v-border-strong px-5 py-6 ${over ? "bg-v-accent-wash ring-2 ring-v-accent/40" : "bg-v-accent-wash"}`}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] bg-v-device-bg text-v-accent" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8a2 2 0 012-2h2l1.5-2h5L16 6h2a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </span>
          <div>
            <p className="text-[16px] font-bold text-v-text">Add photos of your essay</p>
            <p className="mt-1 text-[13.5px] leading-snug text-v-text-secondary">
              One photo per page. We read them in order. JPEG, PNG, WebP or HEIC, up to {MAX_MB} MB each.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Button variant="secondary" onClick={() => cameraRef.current?.click()} className="flex-1">
            Take photo
          </Button>
          <Button variant="secondary" onClick={() => galleryRef.current?.click()} className="flex-1">
            Choose from gallery
          </Button>
        </div>
        <p className="mt-3 hidden text-[12.5px] text-v-text-muted lg:block">Or drag and drop images here.</p>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={galleryRef} type="file" accept={ACCEPT.join(",")} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </div>

      {error && (
        <p role="alert" className="rounded-[10px] border border-v-alert bg-v-alert-wash px-4 py-3 text-sm text-v-alert-text">
          {error}
        </p>
      )}

      {pages.length > 0 && (
        <div>
          <ul className="grid grid-cols-2 gap-3">
            {pages.map((p, i) => (
              <li key={p.id}>
                <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] border border-v-device-border bg-v-device-bg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Page ${i + 1} of your essay`} className="absolute inset-0 h-full w-full object-contain" />
                  <span className="absolute left-2 top-2 rounded bg-v-device-surface px-1.5 py-0.5 font-data text-[10px] font-bold uppercase tracking-[0.1em] text-v-device-text">
                    Page {i + 1}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <div className="flex">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move page ${i + 1} earlier`} className="grid h-11 w-11 place-items-center text-v-text-secondary disabled:opacity-30">←</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === pages.length - 1} aria-label={`Move page ${i + 1} later`} className="grid h-11 w-11 place-items-center text-v-text-secondary disabled:opacity-30">→</button>
                  </div>
                  <button type="button" onClick={() => setPages((q) => q.filter((x) => x.id !== p.id))} className="min-h-[44px] px-2 text-[13px] font-semibold text-v-alert-text">
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-data text-[11px] uppercase tracking-[0.12em] text-v-text-muted" aria-live="polite">
            {pages.length} {pages.length === 1 ? "page" : "pages"} added
          </p>
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={!ready}
          aria-describedby={ready ? undefined : "submit-why"}
          className="v-btn-primary h-14 w-full rounded-full bg-v-accent-strong text-[15px] font-bold tracking-tight text-v-on-accent disabled:cursor-not-allowed disabled:opacity-60"
          style={ready ? { boxShadow: "var(--v-glow-cta)" } : undefined}
        >
          Analyse my essay
        </button>
        {!ready && (
          <p id="submit-why" className="mt-2 text-center text-[13px] text-v-text-muted">
            {why}
          </p>
        )}
        <p className="mt-3 text-center text-[12.5px] text-v-text-muted">
          Your photos are used only to analyse this essay.
        </p>
      </div>
    </form>
  );
}
