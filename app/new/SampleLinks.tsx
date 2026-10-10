"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getDemoLinks, type DemoLink } from "@/lib/data";

/** A quiet way into the sample analysis, plus any cached demo reports listed in public/demo-reports/index.json. */
export function SampleLinks() {
  const [demos, setDemos] = useState<DemoLink[]>([]);
  useEffect(() => {
    let alive = true;
    getDemoLinks().then((d) => alive && setDemos(d));
    return () => {
      alive = false;
    };
  }, []);
  const link = "inline-flex min-h-[44px] items-center text-[13.5px] font-semibold text-v-accent-text underline underline-offset-4";
  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 text-center">
      <Link href="/report/example" className={link}>Try a sample analysis</Link>
      {demos.map((d) => (
        <Link key={d.id} href={`/report/${d.id}`} className={link}>{d.title}</Link>
      ))}
    </div>
  );
}
