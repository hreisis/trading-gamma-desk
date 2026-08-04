import type { StudyMemoBullet } from "@/contracts";
import type {
  DecisionEvidenceSummary,
  DecisionSurfaceView,
  HorizonEvidenceDisplay,
} from "@/contracts/decision-surface";
import { structureConditionLabel } from "@/desk/build-desk-stance";
import { PUBLIC_DEMO_COMPACT_BANNER } from "@/desk/public-demo";
import { DeskChrome } from "./DeskChrome";

function MemoBullets({
  title,
  bullets,
}: {
  title: string;
  bullets: readonly StudyMemoBullet[];
}) {
  if (bullets.length === 0) return null;
  return (
    <div className="decision-subblock" data-testid={`research-${title.toLowerCase()}`}>
      <h3 className="decision-subtitle">{title}</h3>
      <ul className="decision-list">
        {bullets.map((bullet) => (
          <li key={bullet.id} className="decision-list-item">
            <p>{bullet.text}</p>
            <p className="decision-citations" data-testid={`citation-${bullet.id}`}>
              {bullet.bundleFieldPaths.join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HorizonRow({ row }: { row: HorizonEvidenceDisplay }) {
  return (
    <tr data-testid={`horizon-${row.horizon}`}>
      <td>{row.horizon}</td>
      <td>{row.evidenceStatus.replaceAll("_", " ")}</td>
      <td>{row.matureCount}</td>
      <td>{row.sampleSize}</td>
      <td>{row.meanReturn}</td>
      <td>{row.medianReturn}</td>
      <td>{row.positiveRate}</td>
      <td>{row.meanMfe}</td>
      <td>{row.meanMae}</td>
    </tr>
  );
}

function EvidencePanel({ summary }: { summary: DecisionEvidenceSummary }) {
  const horizons = [summary.horizons.d1, summary.horizons.d5, summary.horizons.d20];
  return (
    <div className="decision-evidence" data-testid="decision-evidence">
      <div className="decision-evidence-header">
        <p className="decision-label">Deterministic evidence</p>
        <p className="decision-value" data-testid="evidence-status-label">
          {summary.evidenceStatusLabel}
        </p>
        <p className="decision-muted" data-testid="evidence-strength">
          Strength (display only): {summary.strengthDisplay} — {summary.strengthSummary}
        </p>
        {summary.evidenceStatusNote ? (
          <p className="decision-muted" data-testid="evidence-status-note">
            {summary.evidenceStatusNote}
          </p>
        ) : null}
      </div>
      <dl className="decision-evidence-meta">
        <div>
          <dt>Cohort n</dt>
          <dd data-testid="cohort-n">{summary.cohortMatchedCount}</dd>
        </div>
        <div>
          <dt>Primary horizon mature</dt>
          <dd data-testid="cohort-mature">{summary.cohortMatureCount}</dd>
        </div>
        <div>
          <dt>Primary horizon</dt>
          <dd>{summary.primaryHorizon}</dd>
        </div>
        <div>
          <dt>Cohort quality</dt>
          <dd>{summary.cohortQualityStatus}</dd>
        </div>
      </dl>
      <div className="decision-horizon-table-wrap">
        <table className="decision-horizon-table">
          <thead>
            <tr>
              <th>Horizon</th>
              <th>Status</th>
              <th>Mature</th>
              <th>Sample</th>
              <th>Mean</th>
              <th>Median</th>
              <th>+ rate</th>
              <th>MFE</th>
              <th>MAE</th>
            </tr>
          </thead>
          <tbody>
            {horizons.map((row) => (
              <HorizonRow key={row.horizon} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      {summary.limitations.length > 0 ? (
        <div className="decision-subblock">
          <h3 className="decision-subtitle">Limitations</h3>
          <ul className="decision-list">
            {summary.limitations.map((item) => (
              <li key={item} className="decision-list-item">
                <p>{item}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {summary.cohortWarnings.length > 0 ? (
        <div className="decision-subblock">
          <h3 className="decision-subtitle">Unknowns / warnings</h3>
          <ul className="decision-list">
            {summary.cohortWarnings.map((item) => (
              <li key={item} className="decision-list-item">
                <p>{item}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactIssuesPanel({
  issues,
  studyIntegrityOk,
}: {
  issues: DecisionSurfaceView["artifactIssues"];
  studyIntegrityOk: boolean;
}) {
  if (issues.length === 0) return null;
  return (
    <section className="decision-block desk-state" data-testid="decision-artifact-issues">
      <h2 className="decision-heading">Artifact integrity</h2>
      <ul className="decision-list">
        {issues.map((issue, index) => (
          <li
            key={`${issue.artifact}-${issue.severity}-${index}`}
            className="decision-list-item"
            data-testid={`artifact-issue-${issue.artifact}-${issue.severity}`}
          >
            <p>
              <strong>{issue.artifact.replaceAll("_", " ")}</strong> · {issue.severity}
            </p>
            <p className="decision-muted">{issue.message}</p>
            {issue.path ? (
              <p className="decision-citations">{issue.path}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {!studyIntegrityOk ? (
        <p className="decision-muted" data-testid="stance-suppressed-note">
          Desk stance suppressed — study evidence integrity failed.
        </p>
      ) : null}
    </section>
  );
}

export function DecisionSurface({ view }: { view: DecisionSurfaceView }) {
  const showIntegrityError =
    view.status === "artifacts_missing" ||
    view.status === "integrity_failed" ||
    view.status === "missing_date" ||
    view.status === "date_unavailable";

  return (
    <DeskChrome>
      <article className="decision-surface" data-testid="decision-surface">
        <header className="decision-hero">
          <p className="desk-kicker">Evaluate → Decide</p>
          <h1 className="desk-title">Decision surface</h1>
          {view.sessionDate ? (
            <p className="desk-meta" data-testid="decision-session-date">
              Session {view.sessionDate}
              <span className="desk-banner-meta"> · {view.sourceLabel}</span>
            </p>
          ) : null}
          {view.isPublicDemo ? (
            <p className="desk-banner desk-banner-demo" data-testid="decision-demo-banner">
              {PUBLIC_DEMO_COMPACT_BANNER}
            </p>
          ) : null}
        </header>

        {showIntegrityError && view.errorMessage ? (
          <section className="decision-block desk-state" data-testid="decision-error">
            <p className="desk-banner desk-banner-error">{view.errorMessage}</p>
          </section>
        ) : null}

        <ArtifactIssuesPanel
          issues={view.artifactIssues}
          studyIntegrityOk={view.studyIntegrityOk}
        />

        {view.observe ? (
          <section className="decision-block" data-testid="decision-observe">
            <h2 className="decision-heading">Observe</h2>
            <div className="decision-observe-grid">
              <div className="decision-observe-item">
                <p className="decision-label">Macro driver</p>
                <p className="decision-value">{view.observe.driverLabel}</p>
                <p className="decision-muted">
                  {view.observe.driverRegime} · confidence{" "}
                  {view.observe.confidenceDisplay}
                </p>
                <p className="desk-interpretation">{view.observe.driverInterpretation}</p>
              </div>
              <div className="decision-observe-item">
                <p className="decision-label">Catalysts</p>
                <p className="decision-value">{view.observe.catalystHeadline}</p>
                {view.observe.catalystDetail ? (
                  <p className="decision-muted">{view.observe.catalystDetail}</p>
                ) : null}
              </div>
              <div className="decision-observe-item">
                <p className="decision-label">Bounded structure</p>
                {view.observe.structureSummary ? (
                  <>
                    <p className="decision-value">
                      {structureConditionLabel(view.observe.structureCondition)}
                    </p>
                    <p className="desk-interpretation">{view.observe.structureSummary}</p>
                  </>
                ) : (
                  <p className="decision-muted" data-testid="structure-unavailable">
                    {view.observe.structureUnavailableReason ??
                      "Structure context unavailable."}
                  </p>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {view.research ? (
          <section className="decision-block" data-testid="decision-research">
            <h2 className="decision-heading">Research</h2>
            {view.research.evidenceSummary ? (
              <EvidencePanel summary={view.research.evidenceSummary} />
            ) : null}
            <div className="decision-memo" data-testid="decision-memo">
              <p className="decision-label">AI study memo</p>
              <p className="decision-value">{view.research.memoHeadline}</p>
              <p className="decision-muted" data-testid="memo-provenance">
                {view.research.memoProvenanceLabel} · bundle {view.research.bundleId}
              </p>
            </div>
            <MemoBullets title="Evidence" bullets={view.research.evidence} />
            <MemoBullets title="Inference" bullets={view.research.inference} />
            <MemoBullets title="Limitations" bullets={view.research.limitations} />
            <MemoBullets title="Unknowns" bullets={view.research.unknowns} />
          </section>
        ) : null}

        {view.policy ? (
          <section className="decision-block" data-testid="decision-policy">
            <h2 className="decision-heading">Policy constraint</h2>
            <p className="decision-muted">Status: {view.policy.status}</p>
            <p className="desk-interpretation">{view.policy.message}</p>
          </section>
        ) : null}

        {view.stance ? (
          <section className="decision-block decision-stance" data-testid="decision-stance">
            <h2 className="decision-heading">Desk stance</h2>
            <p className="decision-muted">
              Non-trade descriptive read · evidence {view.stance.evidenceStatus}
              {view.stance.structureCondition
                ? ` · structure ${structureConditionLabel(view.stance.structureCondition)}`
                : ""}
            </p>
            <p className="desk-interpretation">{view.stance.summary}</p>
          </section>
        ) : null}
      </article>
    </DeskChrome>
  );
}
