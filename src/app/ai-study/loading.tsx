import { DeskChrome } from "@/app/components/DeskChrome";

export default function AiStudyLoading() {
  return (
    <DeskChrome activeNav="ai-study">
      <section className="desk-state" data-testid="ai-study-loading">
        <h1 className="desk-title">Generating AI Study…</h1>
        <p className="desk-section-note">
          Collecting desk inputs and preparing the briefing.
        </p>
        <div className="desk-skeleton desk-skeleton-line" />
        <div className="desk-skeleton desk-skeleton-line" />
        <div className="desk-skeleton desk-skeleton-line short" />
      </section>
    </DeskChrome>
  );
}
