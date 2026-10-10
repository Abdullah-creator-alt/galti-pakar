import { Suspense } from "react";
import { FlowShell } from "@/components/Shells";
import { Processing } from "./Processing";

export default function AnalysingPage() {
  return (
    <FlowShell step={2} width={560}>
      <Suspense fallback={<p className="text-center font-data text-[11px] uppercase tracking-[0.2em] text-v-text-muted">Loading</p>}>
        <Processing />
      </Suspense>
    </FlowShell>
  );
}
