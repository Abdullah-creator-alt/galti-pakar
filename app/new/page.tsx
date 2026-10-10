import { FlowHeader, FlowShell } from "@/components/Shells";
import { LIMITATION_TEXT, LimitationNote } from "@/components/ui";
import { SampleLinks } from "./SampleLinks";
import { UploadForm } from "./UploadForm";

export default function NewEssayPage() {
  return (
    <FlowShell step={1}>
      <FlowHeader
        eyebrow="New CSS essay"
        title="Upload your handwritten CSS essay"
        lead="Photograph each page of your answer, outline included if you wrote one. No account needed, and a phone photo is fine."
      />
      <UploadForm />
      <SampleLinks />
      <div className="mt-8">
        <LimitationNote text={LIMITATION_TEXT} />
      </div>
    </FlowShell>
  );
}
