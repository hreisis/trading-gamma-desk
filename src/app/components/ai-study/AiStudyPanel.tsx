import Link from "next/link";
import type {
  AiStudyBriefing,
  AiStudyClaim,
  AiStudyInputProvenance,
} from "@/contracts/ai-study-briefing";
import { claimEvidenceIds, claimText } from "@/ai-study/claim-utils";
import { formatAiStudyMarketStatus } from "@/ai-study/session";
import { RiskTrafficLight } from "../RiskTrafficLight";
import {
  briefHeadline,
  deriveBriefingStance,
  deriveInputDisplayLight,
  inputScanLabel,
  riskLightScanLabel,
} from "../signal-display";

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

function freshnessLabel(
  freshness: AiStudyInputProvenance["freshness"] | undefined,
): string {
  if (!freshness) return "";
  switch (freshness) {
    case "live":
      return "Live";
    case "cached":
      return "Cached";
    case "fixture":
      return "Fixture";
    case "stale":
      return "Stale";
    case "unavailable":
      return "Unavailable";
  }
}

function briefingStatusLabel(status: AiStudyBriefing["status"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "partial":
      return "Partial";
    case "error":
      return "Error";
    case "session_conflict":
      return "Session conflict";
    case "unavailable":
      return "Unavailable";
    case "synthetic_demo":
      return "Synthetic demo";
  }
}

function formatGeneratedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function formatAsOf(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function ClaimLine({ claim }: { claim: AiStudyClaim | string }) {
  const text = claimText(claim);
  const ids = claimEvidenceIds(claim);
  return (
    <span>
      {text}
      {ids.length > 0 ? (
        <span className="desk-inline-meta"> · evidence: {ids.join(", ")}</span>
      ) : null}
    </span>
  );
}

function BriefUnavailable({
  briefing,
  historicalDate,
  testId,
  title,
}: {
  briefing: AiStudyBriefing;
  historicalDate?: string | null;
  testId: string;
  title: string;
}) {
  const stance = deriveBriefingStance(briefing);
  return (
    <div className="signal-brief" data-testid={testId}>
      <BriefHero briefing={briefing} stance={stance} headline={briefing.message} />
      <details className="desk-fold signal-brief-system" data-testid="ai-study-system-details">
        <summary>Details / System Status</summary>
        <BriefingMeta briefing={briefing} historicalDate={historicalDate} />
        <SessionAlignmentBlock alignment={briefing.sessionAlignment} />
        <InputProvenanceList inputs={briefing.inputs} />
      </details>
      <p className="visually-hidden">{title}</p>
    </div>
  );
}

function BriefHero({
  briefing,
  stance,
  headline,
  signalInputs,
  summaryLines,
}: {
  briefing: AiStudyBriefing;
  stance: ReturnType<typeof deriveBriefingStance>;
  headline: string;
  signalInputs?: readonly AiStudyInputProvenance[];
  summaryLines?: readonly string[];
}) {
  return (
    <header className="signal-brief-hero">
      <div className="signal-brief-top">
        <p className="signal-brief-kicker">AI Daily Brief</p>
        <div className="signal-brief-stance">
          <RiskTrafficLight light={stance.light} compact testId="ai-study-stance-light" />
          <span className={`signal-stance-label signal-stance-${stance.light.kind}`}>
            {stance.label}
          </span>
        </div>
      </div>
      <h1 className="signal-brief-headline">{briefHeadline(headline)}</h1>
      {signalInputs && signalInputs.length > 0 ? (
        <ul className="signal-brief-cards" data-testid="ai-study-signal-cards">
          {signalInputs.map((input) => {
            const light = deriveInputDisplayLight(input);
            return (
              <li key={input.id} className="signal-brief-card">
                <RiskTrafficLight
                  light={light}
                  compact
                  testId={`ai-study-signal-${input.id}`}
                />
                <span className="signal-brief-card-label">{inputScanLabel(input.id)}</span>
                <span className="signal-brief-card-value">{riskLightScanLabel(light)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {summaryLines && summaryLines.length > 0 ? (
        <div className="signal-brief-summary" data-testid="ai-study-summary">
          {summaryLines.map((line) => (
            <p key={line}>{briefHeadline(line, 220)}</p>
          ))}
        </div>
      ) : null}
      <p className="visually-hidden" data-testid="ai-study-briefing-status">
        {briefingStatusLabel(briefing.status)}
      </p>
    </header>
  );
}

export function AiStudyPanel({
  briefing,
  historicalDate,
}: {
  briefing: AiStudyBriefing;
  historicalDate?: string | null;
}) {
  if (
    (briefing.status === "unavailable" || briefing.status === "session_conflict") &&
    !briefing.report
  ) {
    return (
      <BriefUnavailable
        briefing={briefing}
        historicalDate={historicalDate}
        testId="ai-study-unavailable"
        title="AI Study unavailable"
      />
    );
  }

  if (briefing.status === "error" && !briefing.report) {
    return (
      <BriefUnavailable
        briefing={briefing}
        historicalDate={historicalDate}
        testId="ai-study-error"
        title="AI Study error"
      />
    );
  }

  const report = briefing.report;
  if (!report) {
    return (
      <div className="signal-brief" data-testid="ai-study-empty">
        <BriefHero
          briefing={briefing}
          stance={deriveBriefingStance(briefing)}
          headline="No AI Study report payload."
        />
      </div>
    );
  }

  const stance = deriveBriefingStance(briefing);
  const summaryLines = report.mainDrivers
    .slice(0, 3)
    .map((item) => claimText(item));

  return (
    <div className="signal-brief" data-testid="ai-study-panel">
      <BriefHero
        briefing={briefing}
        stance={stance}
        headline={claimText(report.marketRegime)}
        signalInputs={briefing.inputs}
        summaryLines={summaryLines}
      />

      <details className="desk-fold signal-brief-expand">
        <summary>Full report</summary>
        <section className="ai-study-section">
          <h2>Key levels / structure</h2>
          <ul className="desk-list">
            {report.keyLevelsStructure.map((item) => (
              <li key={claimText(item)}>
                <ClaimLine claim={item} />
              </li>
            ))}
          </ul>
        </section>
        <section className="ai-study-section">
          <h2>Upcoming risks</h2>
          <ul className="desk-list">
            {report.upcomingRisks.map((item) => (
              <li key={claimText(item)}>
                <ClaimLine claim={item} />
              </li>
            ))}
          </ul>
        </section>
        <section className="ai-study-section">
          <h2>Scenarios</h2>
          <div className="ai-study-scenarios">
            <article className="ai-study-scenario">
              <h3>Bull</h3>
              <p>
                <ClaimLine claim={report.scenarios.bull} />
              </p>
            </article>
            <article className="ai-study-scenario">
              <h3>Base</h3>
              <p>
                <ClaimLine claim={report.scenarios.base} />
              </p>
            </article>
            <article className="ai-study-scenario">
              <h3>Bear</h3>
              <p>
                <ClaimLine claim={report.scenarios.bear} />
              </p>
            </article>
          </div>
        </section>
      </details>

      <details className="desk-fold signal-brief-system" data-testid="ai-study-system-details">
        <summary>Details / System Status</summary>
        <p className="desk-banner desk-banner-compact" data-testid="ai-study-status-banner">
          {briefing.message}
          {briefing.model ? (
            <span className="desk-inline-meta">
              {" "}
              · model {briefing.model} · {briefing.provider}
            </span>
          ) : null}
          {briefing.usage ? (
            <span className="desk-inline-meta">
              {" "}
              · tokens {briefing.usage.totalTokens} · est $
              {briefing.usage.estimatedCostUsd.toFixed(4)}
            </span>
          ) : null}
        </p>
        {briefing.grounding &&
        (!briefing.grounding.citationsValid ||
          !briefing.grounding.numbersValid ||
          briefing.grounding.prohibitedLanguageDetected) ? (
          <p className="desk-banner desk-banner-warn">
            Grounding validation flagged citation, numeric, or language issues —
            review before relying on this briefing.
          </p>
        ) : null}
        <BriefingMeta briefing={briefing} historicalDate={historicalDate} />
        <SessionAlignmentBlock alignment={briefing.sessionAlignment} />
        <InputProvenanceList inputs={briefing.inputs} />
      </details>
    </div>
  );
}

function BriefingMeta({
  briefing,
  historicalDate,
}: {
  briefing: AiStudyBriefing;
  historicalDate?: string | null;
}) {
  return (
    <section
      className="desk-section desk-section-tight"
      data-testid="ai-study-meta"
    >
      <dl className="desk-meta-grid">
        <div>
          <dt>Mode</dt>
          <dd data-testid="ai-study-mode">
            {briefing.mode === "current" ? "Current / live" : "Historical"}
          </dd>
        </div>
        <div>
          <dt>Target session</dt>
          <dd data-testid="ai-study-session-date">
            {briefing.sessionDate ?? "—"} ({briefing.timezone})
          </dd>
        </div>
        <div>
          <dt>Market status</dt>
          <dd data-testid="ai-study-market-status">
            {formatAiStudyMarketStatus(briefing.marketStatus)}
          </dd>
        </div>
        <div>
          <dt>Briefing status</dt>
          <dd data-testid="ai-study-briefing-status">
            {briefingStatusLabel(briefing.status)}
          </dd>
        </div>
        <div>
          <dt>Generated</dt>
          <dd data-testid="ai-study-generated-at">
            {formatGeneratedAt(briefing.generatedAt)} ET
          </dd>
        </div>
      </dl>
      {historicalDate ? (
        <p className="desk-section-note">
          Viewing historical session {historicalDate}.{" "}
          <Link href="/ai-study">Return to current session</Link>.
        </p>
      ) : null}
    </section>
  );
}

function SessionAlignmentBlock({
  alignment,
}: {
  alignment: AiStudyBriefing["sessionAlignment"];
}) {
  if (!alignment) return null;
  return (
    <section className="desk-section desk-section-tight">
      <h2>Session alignment</h2>
      <p className="desk-section-note">
        Target session: {alignment.targetSessionDate ?? "unknown"} · aligned:{" "}
        {alignment.aligned ? "yes" : "no — partial cached inputs"}
      </p>
      {alignment.conflicts.length > 0 ? (
        <ul className="desk-list">
          {alignment.conflicts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
    </section>
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
            <th scope="col">Provider</th>
            <th scope="col">Session</th>
            <th scope="col">As of</th>
            <th scope="col">Freshness</th>
          </tr>
        </thead>
        <tbody>
          {inputs.map((item) => (
            <tr key={item.id} data-testid={`ai-study-input-${item.id}`}>
              <th scope="row">{item.id.replace(/_/g, " ")}</th>
              <td>{statusLabel(item.status)}</td>
              <td>
                {item.provider ?? item.sourceLabel}
                {item.note ? (
                  <span className="desk-inline-meta"> · {item.note}</span>
                ) : null}
              </td>
              <td>{item.sessionDate ?? "—"}</td>
              <td>{formatAsOf(item.fetchedAt)}</td>
              <td>{freshnessLabel(item.freshness)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
