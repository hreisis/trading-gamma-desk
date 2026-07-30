import type { RiskTrafficLight as RiskTrafficLightModel } from "@/desk/risk-lights";

export function RiskTrafficLight({
  light,
  compact,
  testId = "risk-light",
}: {
  light: RiskTrafficLightModel;
  /** Dot + short label; omit label text in ultra-dense rows when true. */
  compact?: boolean;
  testId?: string;
}) {
  return (
    <span
      className={`risk-light risk-light-${light.kind}${compact ? " risk-light-compact" : ""}`}
      data-testid={testId}
      data-risk-light={light.kind}
      title={light.label}
    >
      <span className="risk-light-dot" aria-hidden="true" />
      {compact ? (
        <span className="visually-hidden">{light.label}</span>
      ) : (
        <span className="risk-light-label">{light.label}</span>
      )}
    </span>
  );
}
