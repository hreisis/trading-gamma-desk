/**
 * Reserved slot for a future 0–100 composite risk score.
 * Calculation not implemented — display only.
 */
export function RiskScorePlaceholder({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <aside
        className="signal-risk-compact"
        aria-labelledby="risk-score-heading"
        data-testid="risk-score-placeholder"
      >
        <span className="signal-risk-compact-label" id="risk-score-heading">
          Risk
        </span>
        <span className="signal-risk-compact-value" aria-hidden="true">
          —
        </span>
        <span className="visually-hidden">Risk score not yet calculated</span>
      </aside>
    );
  }

  return (
    <aside
      className="terminal-risk-score"
      aria-labelledby="risk-score-heading"
      data-testid="risk-score-placeholder"
    >
      <p className="terminal-risk-score-kicker" id="risk-score-heading">
        Risk score
      </p>
      <div className="terminal-risk-score-value" aria-hidden="true">
        <span className="terminal-risk-score-dash">—</span>
        <span className="terminal-risk-score-unit">/ 100</span>
      </div>
      <p className="terminal-risk-score-status">Coming soon</p>
    </aside>
  );
}
