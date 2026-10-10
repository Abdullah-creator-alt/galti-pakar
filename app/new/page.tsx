import { FlowHeader, FlowShell } from "@/components/Shells";
import { LIMITATION_TEXT, LimitationNote } from "@/components/ui";
import { SampleLinks } from "./SampleLinks";
import { UploadForm } from "./UploadForm";

export default function NewEssayPage() {
  return (
    <FlowShell step={1}>
      <FlowHeader
        eyebrow="New essay"
        title="Upload your handwritten essay"
        lead="No account needed to try it. A photo from your phone is fine."
      />
      <UploadForm />
      <SampleLinks />
      <div className="mt-8">
        <LimitationNote text={LIMITATION_TEXT} />
      </div>
    </FlowShell>
  );
}
