import type { BoundedGammaProviderSnapshot } from "@/contracts";
import { formatGexCompact } from "@/desk/format-gamma";

const WIDTH = 860;
const HEIGHT = 280;
const PAD = { top: 28, right: 16, bottom: 36, left: 52 };

export function GexStrikeChart({
  snapshot,
}: {
  snapshot: BoundedGammaProviderSnapshot;
}) {
  const rows = snapshot.byStrike;
  if (rows.length === 0) {
    return (
      <p className="desk-section-note" data-testid="gex-chart-empty">
        No strike-level GEX to chart.
      </p>
    );
  }

  const maxAbs = Math.max(
    ...rows.map((r) => Math.abs(r.callGex) + Math.abs(r.putGex)),
    ...rows.map((r) => Math.abs(r.netGex)),
    1,
  );

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const midY = PAD.top + innerH / 2;
  const barGap = Math.max(1, innerW / rows.length - 1);
  const barW = Math.max(1, Math.min(8, barGap * 0.85));
  const scaleY = (innerH / 2 - 4) / maxAbs;

  const xForIndex = (i: number) =>
    PAD.left + (i + 0.5) * (innerW / rows.length) - barW / 2;

  const strikeToX = (strike: number) => {
    const i = rows.findIndex((r) => r.strike === strike);
    if (i < 0) {
      const min = rows[0]!.strike;
      const max = rows[rows.length - 1]!.strike;
      const t = max === min ? 0 : (strike - min) / (max - min);
      return PAD.left + t * innerW;
    }
    return xForIndex(i) + barW / 2;
  };

  const callWall =
    snapshot.boundedCallWall.status !== "unavailable"
      ? snapshot.boundedCallWall.strike
      : undefined;
  const putWall =
    snapshot.boundedPutWall.status !== "unavailable"
      ? snapshot.boundedPutWall.strike
      : undefined;
  const spot = snapshot.spot;

  const tickStrikes = [
    rows[0]!.strike,
    rows[Math.floor(rows.length / 2)]!.strike,
    rows[rows.length - 1]!.strike,
  ];

  return (
    <div className="gs-chart-wrap" data-testid="gex-strike-chart">
      <svg
        className="gs-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Strike-level net GEX bar chart for bounded single-expiry sample"
      >
        <line
          className="gs-chart-axis"
          x1={PAD.left}
          y1={midY}
          x2={WIDTH - PAD.right}
          y2={midY}
        />
        {rows.map((row, i) => {
          const x = xForIndex(i);
          const h = Math.abs(row.netGex) * scaleY;
          const y = row.netGex >= 0 ? midY - h : midY;
          const cls =
            row.netGex >= 0 ? "gs-bar gs-bar-pos" : "gs-bar gs-bar-neg";
          return (
            <rect
              key={row.strike}
              className={cls}
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, 0.5)}
            >
              <title>
                {`Strike ${row.strike}: net ${formatGexCompact(row.netGex)}, call ${formatGexCompact(row.callGex)}, put ${formatGexCompact(row.putGex)}, gross ${formatGexCompact(Math.abs(row.callGex) + Math.abs(row.putGex))}, call OI ${row.callOpenInterest}, put OI ${row.putOpenInterest}`}
              </title>
            </rect>
          );
        })}
        {spot !== null ? (
          <line
            className="gs-marker gs-marker-spot"
            x1={strikeToX(spot)}
            y1={PAD.top}
            x2={strikeToX(spot)}
            y2={HEIGHT - PAD.bottom}
          />
        ) : null}
        {callWall !== undefined ? (
          <line
            className="gs-marker gs-marker-call"
            x1={strikeToX(callWall)}
            y1={PAD.top}
            x2={strikeToX(callWall)}
            y2={HEIGHT - PAD.bottom}
          />
        ) : null}
        {putWall !== undefined ? (
          <line
            className="gs-marker gs-marker-put"
            x1={strikeToX(putWall)}
            y1={PAD.top}
            x2={strikeToX(putWall)}
            y2={HEIGHT - PAD.bottom}
          />
        ) : null}
        {tickStrikes.map((strike) => (
          <text
            key={`tick-${strike}`}
            className="gs-chart-tick"
            x={strikeToX(strike)}
            y={HEIGHT - 12}
            textAnchor="middle"
          >
            {strike}
          </text>
        ))}
      </svg>
      <ul className="gs-chart-legend" aria-label="Chart legend">
        <li>
          <span className="gs-swatch gs-swatch-pos" /> Positive net GEX
        </li>
        <li>
          <span className="gs-swatch gs-swatch-neg" /> Negative net GEX
        </li>
        <li>
          <span className="gs-swatch gs-swatch-spot" /> Spot
        </li>
        <li>
          <span className="gs-swatch gs-swatch-call" /> Bounded Call Wall
        </li>
        <li>
          <span className="gs-swatch gs-swatch-put" /> Bounded Put Wall
        </li>
      </ul>
    </div>
  );
}
