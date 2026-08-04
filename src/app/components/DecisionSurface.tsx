import type { StudyMemoBullet } from "@/contracts";
import type {
  CitationFieldPreview,
  DecisionEvidenceDrillDown,
  DecisionEvidenceSummary,
  DecisionSurfaceView,
  EvidenceDrillDownLane,
  HorizonEvidenceDisplay,
  HorizonEvidenceDrillDown,
  MatchedSessionDisplay,
  MemoBulletDrillDown,
} from "@/contracts/decision-surface";
import { structureConditionLabel } from "@/desk/build-desk-stance";
import {
  DECISION_SURFACE_FIXTURE_SESSION,
} from "@/desk/decision-surface-fixtures";
import {
  PUBLIC_DEMO_COMPACT_BANNER,
  PUBLIC_DEMO_SESSION_LABEL,
} from "@/desk/public-demo";
import {
  type DecisionBadgeTone,
  decisionBadgeClass,
  evidenceStatusTone,
  horizonCoverageSummary,
  integritySummary,
  isDecisionErrorStatus,
  memoSourceShortLabel,
  pageStatusBanner,
  strengthTone,
} from "@/desk/decision-surface-ui";
import { DeskChrome } from "./DeskChrome";

function DecisionBadge({
  label,
  tone,
  testId,
}: {
  label: string;
  tone: DecisionBadgeTone;
  testId?: string;
}) {
  return (
    <span className={decisionBadgeClass(tone)} data-testid={testId}>
      {label}
    </span>
  );
}

function ResearchRibbon({ view }: { view: NonNullable<DecisionSurfaceView["research"]> }) {
  const summary = view.evidenceSummary;
  const coverage = horizonCoverageSummary(summary.horizons);

  return (
    <div className="decision-research-ribbon" data-testid="decision-research-ribbon">
      <DecisionBadge
        label={summary.evidenceStatusLabel}
        tone={evidenceStatusTone(summary.evidenceStatus)}
        testId="ribbon-evidence-status"
      />
      <DecisionBadge
        label={`Strength · ${summary.strengthDisplay}`}
        tone={strengthTone(summary.strengthDisplay)}
        testId="ribbon-strength"
      />
      <DecisionBadge
        label={`Cohort n=${summary.cohortMatchedCount}`}
        tone={summary.cohortMatchedCount <= 1 ? "warn" : "info"}
        testId="ribbon-cohort-n"
      />
      <DecisionBadge
        label={coverage.label}
        tone={coverage.tone}
        testId="ribbon-horizon-coverage"
      />
      <DecisionBadge
        label={`Memo · ${memoSourceShortLabel({
          memoStatus: view.memoStatus,
          memoSourceLabel: view.memoSourceLabel,
        })}`}
        tone={view.memoStatus === "abstained" ? "neutral" : "info"}
        testId="ribbon-memo-source"
      />
    </div>
  );
}

function PageIntegrityRibbon({ view }: { view: DecisionSurfaceView }) {
  const integrity = integritySummary(view);
  if (view.artifactIssues.length === 0 && view.studyIntegrityOk) return null;
  return (
    <div className="decision-integrity-ribbon" data-testid="decision-integrity-ribbon">
      <DecisionBadge label={integrity.label} tone={integrity.tone} testId="ribbon-integrity" />
      {!view.studyIntegrityOk ? (
        <span className="decision-muted">Desk stance suppressed until study artifacts align.</span>
      ) : null}
    </div>
  );
}

function PageStatusBanner({ view }: { view: DecisionSurfaceView }) {
  const banner = pageStatusBanner(view);
  if (!banner) return null;
  return (
    <section
      className={`decision-status-banner decision-status-banner-${banner.tone}`}
      data-testid="decision-page-status"
      role="status"
      aria-live="polite"
    >
      <p className="decision-status-banner-title">{banner.label}</p>
      {banner.detail ? <p className="decision-muted">{banner.detail}</p> : null}
      {view.status === "missing_date" || view.status === "date_unavailable" ? (
        <p className="decision-status-banner-action">
          Try the bundled demo session:{" "}
          <a href={`/decide?date=${DECISION_SURFACE_FIXTURE_SESSION}`}>
            {DECISION_SURFACE_FIXTURE_SESSION}
          </a>
        </p>
      ) : null}
    </section>
  );
}

function laneClass(lane: EvidenceDrillDownLane): string {
  return `decision-lane decision-lane-${lane}`;
}

function CitationDetails({ citations }: { citations: readonly CitationFieldPreview[] }) {
  return (
    <ul className="decision-citation-list" aria-label="Memo citation paths">
      {citations.map((citation) => (
        <li key={citation.path} className="decision-citation-item">
          <details className="decision-citation-details">
            <summary
              className="decision-citation-summary"
              aria-label={`Citation ${citation.path}`}
            >
              {citation.path}
            </summary>
            <p
              className="decision-citation-value"
              data-testid={`citation-value-${citation.path.replaceAll(".", "-")}`}
            >
              {citation.displayValue}
            </p>
          </details>
        </li>
      ))}
    </ul>
  );
}

function MemoBulletsDrillDown({ bullets }: { bullets: readonly MemoBulletDrillDown[] }) {
  const byLane = {
    deterministic: bullets.filter((b) => b.lane === "deterministic"),
    inference: bullets.filter((b) => b.lane === "inference"),
    limitations: bullets.filter((b) => b.lane === "limitations"),
    unknowns: bullets.filter((b) => b.lane === "unknowns"),
  };

  return (
    <>
      {(
        [
          ["Evidence", "deterministic", byLane.deterministic],
          ["Inference", "inference", byLane.inference],
          ["Limitations", "limitations", byLane.limitations],
          ["Unknowns", "unknowns", byLane.unknowns],
        ] as const
      ).map(([title, lane, laneBullets]) => {
        if (laneBullets.length === 0) return null;
        return (
          <div
            key={lane}
            className={`decision-subblock ${laneClass(lane)}`}
            data-testid={`research-${title.toLowerCase()}`}
          >
            <h3 className="decision-subtitle">{title}</h3>
            <ul className="decision-list">
              {laneBullets.map((bullet) => (
                <li key={bullet.id} className="decision-list-item">
                  <p>{bullet.text}</p>
                  <CitationDetails citations={bullet.citations} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function MemoBullets({
  title,
  bullets,
  lane,
}: {
  title: string;
  bullets: readonly StudyMemoBullet[];
  lane: EvidenceDrillDownLane;
}) {
  if (bullets.length === 0) return null;
  return (
    <div
      className={`decision-subblock ${laneClass(lane)}`}
      data-testid={`research-${title.toLowerCase()}-summary`}
    >
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

function HorizonDrillRow({ row }: { row: HorizonEvidenceDrillDown }) {
  return (
    <tr data-testid={`horizon-drill-${row.horizon}`}>
      <td>{row.horizon}</td>
      <td>{row.evidenceStatus.replaceAll("_", " ")}</td>
      <td>{row.matureCount}</td>
      <td>{row.sampleSize}</td>
      <td>{row.meanReturn}</td>
      <td>{row.medianReturn}</td>
      <td>{row.positiveRate}</td>
      <td>{row.meanMfe}</td>
      <td>{row.medianMfe}</td>
      <td>{row.meanMae}</td>
      <td>{row.medianMae}</td>
    </tr>
  );
}

function MatchedSessionRow({ session }: { session: MatchedSessionDisplay }) {
  return (
    <details
      className="decision-matched-session"
      data-testid={`matched-session-${session.sessionDate}`}
    >
      <summary aria-label={`Matched session ${session.sessionDate}`}>
        <span className="decision-value">{session.sessionDate}</span>
        <span className="decision-muted">
          {" "}
          · profile {session.profileStatus} · outcome {session.outcomeStatus}
        </span>
      </summary>
      <div className="decision-matched-session-body">
        <p className="decision-muted">Study {session.studyId}</p>
        {session.missingDataNotes.length > 0 ? (
          <ul className="decision-list">
            {session.missingDataNotes.map((note) => (
              <li key={note} className="decision-list-item decision-lane-unknowns">
                <p>{note}</p>
              </li>
            ))}
          </ul>
        ) : null}
        <table className="decision-horizon-table">
          <thead>
            <tr>
              <th>Factor</th>
              <th>Value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {session.matchFields.map((field) => (
              <tr key={field.factor}>
                <td>{field.factor.replaceAll("_", " ")}</td>
                <td>{field.queryValue}</td>
                <td>{field.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="decision-horizon-table">
          <thead>
            <tr>
              <th>Horizon</th>
              <th>Maturity</th>
              <th>Return</th>
              <th>MFE</th>
              <th>MAE</th>
            </tr>
          </thead>
          <tbody>
            {session.horizons.map((row) => (
              <tr key={row.horizon}>
                <td>{row.horizon}</td>
                <td>{row.maturity}</td>
                <td>{row.return}</td>
                <td>{row.mfe}</td>
                <td>{row.mae}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function EvidenceDrillDownPanel({ drillDown }: { drillDown: DecisionEvidenceDrillDown }) {
  const horizons = [drillDown.horizons.d1, drillDown.horizons.d5, drillDown.horizons.d20];
  return (
    <details
      className="decision-drilldown"
      data-testid="decision-evidence-drilldown"
    >
      <summary
        className="decision-drilldown-summary"
        aria-label="Expand study evidence drill-down"
      >
        Inspect study evidence (horizons, matched sessions, citations)
      </summary>
      <div className="decision-drilldown-body" id="decision-evidence-drilldown-panel">
        <section className={`decision-subblock ${laneClass("deterministic")}`} data-testid="drilldown-match-fields">
          <h3 className="decision-subtitle">Query match fields</h3>
          <table className="decision-horizon-table">
            <thead>
              <tr>
                <th>Factor</th>
                <th>Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {drillDown.queryMatchFields.map((field) => (
                <tr key={field.factor}>
                  <td>{field.factor.replaceAll("_", " ")}</td>
                  <td>{field.queryValue}</td>
                  <td>{field.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className={`decision-subblock ${laneClass("deterministic")}`} data-testid="drilldown-match-criteria">
          <h3 className="decision-subtitle">Match criteria</h3>
          <p className="decision-muted">
            Factors: {drillDown.matchCriteria.factors.join(", ")} · exclude query:{" "}
            {drillDown.matchCriteria.excludeQueryStudy ? "yes" : "no"} · min mature:{" "}
            {drillDown.matchCriteria.minMatureSampleSize}
          </p>
        </section>

        <section className={`decision-subblock ${laneClass("deterministic")}`} data-testid="drilldown-similarity">
          <h3 className="decision-subtitle">Similarity details</h3>
          <p className="decision-muted">
            Matched factors: {drillDown.similarity.matchedFactors.join(", ")} · rejected:{" "}
            {drillDown.similarity.rejectedStudyCount}
          </p>
          <p className="decision-muted">
            Status basis: {drillDown.similarity.statusBasisRuleId}
          </p>
          <ul className="decision-list">
            {drillDown.similarity.statusBasisReasons.map((reason) => (
              <li key={reason} className="decision-list-item">
                <p>{reason}</p>
              </li>
            ))}
          </ul>
          {drillDown.similarity.differentFactors.length > 0 ? (
            <ul className="decision-list">
              {drillDown.similarity.differentFactors.map((entry) => (
                <li key={entry.factor} className="decision-list-item">
                  <p>
                    {entry.factor}: {entry.distinctValues.join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className={`decision-subblock ${laneClass("deterministic")}`} data-testid="drilldown-horizons">
          <h3 className="decision-subtitle">Full horizon evidence (1D / 5D / 20D + MFE / MAE)</h3>
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
                  <th>Mean MFE</th>
                  <th>Med MFE</th>
                  <th>Mean MAE</th>
                  <th>Med MAE</th>
                </tr>
              </thead>
              <tbody>
                {horizons.map((row) => (
                  <HorizonDrillRow key={row.horizon} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          {horizons.map((row) =>
            row.statusBasisReasons.length > 0 ? (
              <details key={`${row.horizon}-basis`} className="decision-horizon-basis">
                <summary aria-label={`${row.horizon} status basis details`}>
                  {row.horizon} status basis
                </summary>
                <ul className="decision-list">
                  {row.statusBasisReasons.map((reason) => (
                    <li key={reason} className="decision-list-item">
                      <p>{reason}</p>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null,
          )}
        </section>

        <section className={`decision-subblock ${laneClass("deterministic")}`} data-testid="drilldown-matched-sessions">
          <h3 className="decision-subtitle">Matched historical sessions</h3>
          {drillDown.matchedSessions.length === 0 ? (
            <p className="decision-muted">No matched sessions in cohort.</p>
          ) : (
            drillDown.matchedSessions.map((session) => (
              <MatchedSessionRow key={session.studyId} session={session} />
            ))
          )}
        </section>

        <section className={`decision-subblock ${laneClass("limitations")}`} data-testid="drilldown-limitations">
          <h3 className="decision-subtitle">Limitations</h3>
          <ul className="decision-list">
            {drillDown.bundleLimitations.map((item) => (
              <li key={item} className="decision-list-item">
                <p>{item}</p>
              </li>
            ))}
          </ul>
        </section>

        {drillDown.cohortUnknowns.length > 0 ? (
          <section className={`decision-subblock ${laneClass("unknowns")}`} data-testid="drilldown-unknowns">
            <h3 className="decision-subtitle">Unknowns / warnings</h3>
            <ul className="decision-list">
              {drillDown.cohortUnknowns.map((item) => (
                <li key={item} className="decision-list-item">
                  <p>{item}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {drillDown.memoBullets.length > 0 ? (
          <section data-testid="drilldown-memo-citations">
            <h3 className="decision-subtitle">AI memo citations</h3>
            <MemoBulletsDrillDown bullets={drillDown.memoBullets} />
          </section>
        ) : null}
      </div>
    </details>
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
        <div className="decision-evidence-status-row">
          <p className="decision-value" data-testid="evidence-status-label">
            {summary.evidenceStatusLabel}
          </p>
          <DecisionBadge
            label={summary.strengthDisplay}
            tone={strengthTone(summary.strengthDisplay)}
            testId="evidence-strength-badge"
          />
        </div>
        <p className="decision-muted" data-testid="evidence-strength">
          {summary.strengthSummary}
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
  const showIntegrityError = isDecisionErrorStatus(view.status);

  return (
    <DeskChrome activeNav="decide">
      <article className="decision-surface" data-testid="decision-surface">
        <header className="decision-hero">
          <p className="desk-kicker">Evaluate → Decide</p>
          <h1 className="desk-title">Decision surface</h1>
          {view.sessionDate ? (
            <p className="desk-meta" data-testid="decision-session-date">
              {view.isPublicDemo ? (
                <>
                  {PUBLIC_DEMO_SESSION_LABEL} · {view.sessionDate}
                </>
              ) : (
                <>Session {view.sessionDate}</>
              )}
              <span className="desk-banner-meta"> · {view.sourceLabel}</span>
            </p>
          ) : null}
          {view.isPublicDemo ? (
            <p
              className="desk-banner desk-banner-demo decision-demo-banner"
              data-testid="decision-demo-banner"
              role="note"
            >
              {PUBLIC_DEMO_COMPACT_BANNER}
            </p>
          ) : null}
        </header>

        <PageStatusBanner view={view} />
        <PageIntegrityRibbon view={view} />

        {showIntegrityError && view.errorMessage ? (
          <section
            className="decision-block desk-state decision-empty-state"
            data-testid="decision-error"
            role="alert"
          >
            <p className="desk-banner desk-banner-error">{view.errorMessage}</p>
          </section>
        ) : null}

        <ArtifactIssuesPanel
          issues={view.artifactIssues}
          studyIntegrityOk={view.studyIntegrityOk}
        />

        {view.observe ? (
          <section
            className="decision-block"
            data-testid="decision-observe"
            aria-labelledby="decision-observe-heading"
          >
            <h2 className="decision-heading" id="decision-observe-heading">
              Observe
            </h2>
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
          <section
            className="decision-block"
            data-testid="decision-research"
            aria-labelledby="decision-research-heading"
          >
            <h2 className="decision-heading" id="decision-research-heading">
              Research
            </h2>
            <ResearchRibbon view={view.research} />
            {view.research.evidenceSummary ? (
              <EvidencePanel summary={view.research.evidenceSummary} />
            ) : null}
            {view.research.evidenceDrillDown ? (
              <EvidenceDrillDownPanel drillDown={view.research.evidenceDrillDown} />
            ) : null}
            <div className="decision-memo" data-testid="decision-memo">
              <p className="decision-label">AI study memo</p>
              <div className="decision-memo-header">
                <p className="decision-value">{view.research.memoHeadline}</p>
                <DecisionBadge
                  label={memoSourceShortLabel({
                    memoStatus: view.research.memoStatus,
                    memoSourceLabel: view.research.memoSourceLabel,
                  })}
                  tone={
                    view.research.memoStatus === "abstained" ||
                    view.research.memoStatus === "unavailable"
                      ? "neutral"
                      : "info"
                  }
                  testId="memo-source-badge"
                />
              </div>
              <p className="decision-muted" data-testid="memo-provenance">
                {view.research.memoProvenanceLabel} · bundle {view.research.bundleId}
              </p>
            </div>
            <MemoBullets title="Evidence" bullets={view.research.evidence} lane="deterministic" />
            <MemoBullets title="Inference" bullets={view.research.inference} lane="inference" />
            <MemoBullets title="Limitations" bullets={view.research.limitations} lane="limitations" />
            <MemoBullets title="Unknowns" bullets={view.research.unknowns} lane="unknowns" />
          </section>
        ) : null}

        {view.policy ? (
          <section
            className="decision-block"
            data-testid="decision-policy"
            aria-labelledby="decision-policy-heading"
          >
            <h2 className="decision-heading" id="decision-policy-heading">
              Policy constraint
            </h2>
            <p className="decision-muted">Status: {view.policy.status}</p>
            <p className="desk-interpretation">{view.policy.message}</p>
          </section>
        ) : null}

        {view.stance ? (
          <section
            className="decision-block decision-stance"
            data-testid="decision-stance"
            aria-labelledby="decision-stance-heading"
          >
            <h2 className="decision-heading" id="decision-stance-heading">
              Desk stance
            </h2>
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
