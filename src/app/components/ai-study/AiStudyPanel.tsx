import type { AiStudyBriefing, AiStudyInputProvenance } from "@/contracts/ai-study-briefing";

function statusLabel(status: AiStudyInputProvenance["status"]): string {
  switch (status) {
    case "available":
      return "Live input";
    case "fixture":
      return "Fixture";
    case "partial":
      return "Partial";
    case "unavailable":
      return "Unavailable";
  }
}

export function AiStudyPanel({ briefing }: { briefing: AiStudyBriefing }) {
  const bannerClass =
    briefing.status === "synthetic_demo"
      ? "desk-banner desk-banner-warn"
      : briefing.status === "error"
        ? "desk-banner desk-banner-warn"
        : briefing.status === "unavailable"
          ? "desk-banner desk-banner-compact"
          : "desk-banner desk-banner-compact";

  if (briefing.status === "unavailable" && !briefing.report) {
    return (
      <section className="desk-state" data-testid="ai-study-unavailable">
        <h2 className="desk-title">AI Study unavailable</h2>
        <p className="desk-interpretation">{briefing.message}</p>
        <InputProvenanceList inputs={briefing.inputs} />
      </section>
    );
  }

  if (briefing.status === "error" && !briefing.report) {
    return (
      <section className="desk-state" data-testid="ai-study-error">
        <h2 className="desk-title">AI Study error</h2>
        <p className="desk-interpretation">{briefing.message}</p>
        <InputProvenanceList inputs={briefing.inputs} />
      </section>
    );
  }

  const report = briefing.report;
  if (!report) {
    return (
      <section className="desk-state" data-testid="ai-study-empty">
        <p className="desk-interpretation">No AI Study report payload.</p>
      </section>
    );
  }

  return (
    <div data-testid="ai-study-panel">
      <p className={bannerClass} data-testid="ai-study-status-banner">
        {briefing.message}
        {briefing.model ? (
          <span className="desk-inline-meta">
            {" "}
            · model {briefing.model} · {briefing.provider}
          </span>
        ) : null}
      </p>

      <InputProvenanceList inputs={briefing.inputs} />

      <section className="desk-section ai-study-section">
        <h2>1. Market regime</h2>
        <p className="desk-interpretation">{report.marketRegime}</p>
      </section>

      <section className="desk-section ai-study-section">
        <h2>2. Main drivers</h2>
        <ul className="desk-list">
          {report.mainDrivers.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="desk-section ai-study-section">
        <h2>3. Key levels / structure</h2>
        <ul className="desk-list">
          {report.keyLevelsStructure.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="desk-section ai-study-section">
        <h2>4. Upcoming risks</h2>
        <ul className="desk-list">
          {report.upcomingRisks.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="desk-section ai-study-section">
        <h2>5. Scenarios</h2>
        <div className="ai-study-scenarios">
          <article className="ai-study-scenario">
            <h3>Bull</h3>
            <p>{report.scenarios.bull}</p>
          </article>
          <article className="ai-study-scenario">
            <h3>Base</h3>
            <p>{report.scenarios.base}</p>
          </article>
          <article className="ai-study-scenario">
            <h3>Bear</h3>
            <p>{report.scenarios.bear}</p>
          </article>
        </div>
      </section>
    </div>
  );
}

function InputProvenanceList({
  inputs,
}: {
  inputs: readonly AiStudyInputProvenance[];
}) {
  return (
    <section
      className="desk-section desk-section-tight"
      aria-labelledby="ai-study-inputs-heading"
    >
      <h2 id="ai-study-inputs-heading">Input provenance</h2>
      <table className="desk-table" data-testid="ai-study-inputs-table">
        <thead>
          <tr>
            <th scope="col">Input</th>
            <th scope="col">Status</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {inputs.map((item) => (
            <tr key={item.id} data-testid={`ai-study-input-${item.id}`}>
              <th scope="row">{item.id.replace(/_/g, " ")}</th>
              <td>{statusLabel(item.status)}</td>
              <td>
                {item.sourceLabel}
                {item.note ? (
                  <span className="desk-inline-meta"> · {item.note}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
