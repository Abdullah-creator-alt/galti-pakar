"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { setSubmission } from "@/lib/client/analysisStore";
import { compressPhotos, formatBytes, UnsupportedImageError } from "@/lib/client/compressImages";

const MAX_PAGES = 12;
const MAX_ORIGINAL_MB = 25; // a sanity limit before decoding; the upload itself is compressed
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const BAD_FORMAT = "Please use a JPEG or PNG photo.";

const TOPICS = [
  "Climate change and Pakistan's economic future",
  "Water scarcity and food security",
  "Terrorism and the national narrative",
  "Youth unemployment in Pakistan",
  "Democracy and governance in developing states",
];

interface Page {
  id: string;
  file: File;
  url: string;
}

type Prep =
  | { status: "idle" }
  | { status: "working"; done: number; total: number }
  | { status: "ready"; files: File[]; total: number }
  | { status: "too-large"; total: number };

export function UploadForm() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [prep, setPrep] = useState<Prep>({ status: "idle" });
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const run = useRef(0);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  // Compress whenever the list or its order changes. A newer run makes an older one stale.
  useEffect(() => {
    const id = ++run.current;
    if (pages.length === 0) {
      setPrep({ status: "idle" });
      return;
    }
    setPrep({ status: "working", done: 0, total: pages.length });
    const t = setTimeout(async () => {
      try {
        const r = await compressPhotos(
          pages.map((p) => p.file),
          (done, total) => run.current === id && setPrep({ status: "working", done, total }),
        );
        if (run.current !== id) return;
        setPrep(r.ok ? { status: "ready", files: r.files, total: r.total } : { status: "too-large", total: r.total });
      } catch (e) {
        if (run.current !== id) return;
        if (e instanceof UnsupportedImageError) {
          setError(`"${e.fileName}" could not be read. ${BAD_FORMAT}`);
          setPages((p) => p.filter((x) => x.file.name !== e.fileName));
        } else {
          setError("We could not prepare those photos. Please try different ones.");
          setPrep({ status: "idle" });
        }
      }
    }, 150);
    return () => clearTimeout(t);
  }, [pages]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const added: Page[] = [];
    let problem: string | null = null;
    for (const f of Array.from(list)) {
      if (/heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)) {
        problem = `"${f.name}" is a HEIC photo. ${BAD_FORMAT}`;
        continue;
      }
      if (!ACCEPT.includes(f.type)) {
        problem = `"${f.name}" is not a supported image. ${BAD_FORMAT}`;
        continue;
      }
      if (f.size > MAX_ORIGINAL_MB * 1024 * 1024) {
        problem = `"${f.name}" is larger than ${MAX_ORIGINAL_MB} MB. Retake it at a lower resolution.`;
        continue;
      }
      if (pages.length + added.length >= MAX_PAGES) {
        problem = `You can add up to ${MAX_PAGES} pages. The extra photos were not added.`;
        break;
      }
      const url = URL.createObjectURL(f);
      urls.current.push(url);
      added.push({ id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`, file: f, url });
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

  const topicOk = topic.trim().length > 2;
  const ready = topicOk && prep.status === "ready";
  const why = !topicOk && pages.length === 0 ? "Add a topic and at least one photo to continue." : !topicOk ? "Add the CSS essay topic to continue." : pages.length === 0 ? "Add at least one photo to continue." : prep.status === "working" ? "Preparing your photos..." : prep.status === "too-large" ? "These pages are too large to send together. Remove a few, or retake them at a lower resolution." : "";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || prep.status !== "ready") return;
    // The photos and topic go into an in-memory store, so the request survives the navigation.
    setSubmission({ topic: topic.trim(), files: prep.files });
    // Development only: /new?debug=1 carries on to /analysing?debug=1 (the processing page ignores it in production).
    const debug = new URLSearchParams(window.location.search).get("debug") === "1";
    router.push(debug ? "/analysing?debug=1" : "/analysing");
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <div className="space-y-1.5">
        <label htmlFor="topic" className="text-[13.5px] font-semibold text-v-text">CSS essay topic</label>
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
        <datalist id="topics">{TOPICS.map((t) => <option key={t} value={t} />)}</datalist>
        <p id="topic-hint" className="text-[12.5px] leading-snug text-v-text-muted">Type the topic you chose for this practice essay, or try one of these example topics.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {TOPICS.slice(0, 3).map((t) => (
            <button key={t} type="button" onClick={() => setTopic(t)} className="min-h-[44px] rounded-full border border-v-border px-4 text-[13px] text-v-text-secondary transition-colors hover:border-v-border-strong">
              {t}
            </button>
          ))}
        </div>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
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
            <p className="text-[16px] font-bold text-v-text">Add photos of your answer pages</p>
            <p className="mt-1 text-[13.5px] leading-snug text-v-text-secondary">One photo per page, in order. Put your outline first if you wrote one. We read the pages in order. JPEG or PNG; photos are shrunk on your device before they are sent.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Button variant="secondary" onClick={() => cameraRef.current?.click()} className="flex-1">Take photo</Button>
          <Button variant="secondary" onClick={() => galleryRef.current?.click()} className="flex-1">Choose from gallery</Button>
        </div>
        <p className="mt-3 hidden text-[12.5px] text-v-text-muted lg:block">Or drag and drop images here.</p>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={galleryRef} type="file" accept={[...ACCEPT, ".heic", ".heif"].join(",")} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </div>

      {error && (
        <p role="alert" className="rounded-[10px] border border-v-alert bg-v-alert-wash px-4 py-3 text-sm text-v-alert-text">{error}</p>
      )}

      {pages.length > 0 && (
        <div>
          <ul className="grid grid-cols-2 gap-3">
            {pages.map((p, i) => (
              <li key={p.id}>
                <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] border border-v-device-border bg-v-device-bg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Page ${i + 1} of your CSS essay`} className="absolute inset-0 h-full w-full object-contain" />
                  <span className="absolute left-2 top-2 rounded bg-v-device-surface px-1.5 py-0.5 font-data text-[10px] font-bold uppercase tracking-[0.1em] text-v-device-text">Page {i + 1}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <div className="flex">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move page ${i + 1} earlier`} className="grid h-11 w-11 place-items-center text-v-text-secondary disabled:opacity-30">←</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === pages.length - 1} aria-label={`Move page ${i + 1} later`} className="grid h-11 w-11 place-items-center text-v-text-secondary disabled:opacity-30">→</button>
                  </div>
                  <button type="button" onClick={() => setPages((q) => q.filter((x) => x.id !== p.id))} className="min-h-[44px] px-2 text-[13px] font-semibold text-v-alert-text">Remove</button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-data text-[11px] uppercase tracking-[0.12em] text-v-text-muted" aria-live="polite">
            {pages.length} {pages.length === 1 ? "page" : "pages"} added
            {prep.status === "working" && ` · preparing ${Math.min(prep.done + 1, prep.total)} of ${prep.total}`}
            {prep.status === "ready" && ` · ${formatBytes(prep.total)} after compression`}
          </p>
          {prep.status === "too-large" && (
            <p role="alert" className="mt-2 rounded-[10px] border border-v-flag bg-v-flag-wash px-4 py-3 text-sm text-v-flag-text">
              Even after shrinking, these pages come to {formatBytes(prep.total)}, which is too much to send at once. Please use fewer pages.
            </p>
          )}
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
          Analyse my CSS essay
        </button>
        {!ready && <p id="submit-why" className="mt-2 text-center text-[13px] text-v-text-muted">{why}</p>}
        <p className="mt-3 text-center text-[12.5px] text-v-text-muted">
          Your photos are sent only to analyse this essay. They are not saved on this device, only the report is.
        </p>
      </div>
    </form>
  );
}
