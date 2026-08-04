import type { StudyMemoBullet } from "@/contracts";
import type { DecisionSurfaceView } from "@/contracts/decision-surface";
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

export function DecisionSurface({ view }: { view: DecisionSurfaceView }) {
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

        {view.status === "missing_date" || view.status === "date_unavailable" ? (
          <section className="decision-block desk-state" data-testid="decision-error">
            <p className="desk-banner desk-banner-error">{view.errorMessage}</p>
          </section>
        ) : null}

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
            <p className="decision-value">{view.research.memoHeadline}</p>
            <p className="decision-muted">
              {view.research.memoStatus} · {view.research.memoProvider} · bundle{" "}
              {view.research.bundleId}
            </p>
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
