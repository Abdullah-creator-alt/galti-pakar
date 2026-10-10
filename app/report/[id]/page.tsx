import { AppShell } from "@/components/Shells";
import { ReportLoader } from "@/components/report/ReportLoader";

/** The report lives in the browser (localStorage), so it is loaded client-side with a skeleton and a not-found state. */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <ReportLoader id={id} />
    </AppShell>
  );
}
