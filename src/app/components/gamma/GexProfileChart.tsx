import type { BoundedGammaProviderSnapshot } from "@/contracts";
import type { StrikeGexLevel } from "@/contracts/estimated-gamma";
import { formatGexCompact } from "@/desk/format-gamma";
import { readGammaFlipStrike } from "./gamma-regime-display";
import { selectProfileStrikeRows } from "./select-profile-strikes";

const WIDTH = 420;
const ROW_H = 12;
const PAD = { top: 8, right: 12, bottom: 8, left: 44 };

function yForRowIndex(index: number): number {
  return PAD.top + index * ROW_H + ROW_H / 2;
}

function interpolateStrikeY(
  strike: number,
  rowsAsc: readonly StrikeGexLevel[],
  rowIndexByStrike: ReadonlyMap<number, number>,
): number | null {
  if (!Number.isFinite(strike) || rowsAsc.length === 0) return null;

  if (rowIndexByStrike.has(strike)) {
    return yForRowIndex(rowIndexByStrike.get(strike)!);
  }

  const first = rowsAsc[0]!;
  const last = rowsAsc[rowsAsc.length - 1]!;

  if (strike <= first.strike) {
    return yForRowIndex(rowIndexByStrike.get(first.strike) ?? 0);
  }
  if (strike >= last.strike) {
    return yForRowIndex(rowIndexByStrike.get(last.strike) ?? rowsAsc.length - 1);
  }

  for (let i = 0; i < rowsAsc.length - 1; i++) {
    const low = rowsAsc[i]!;
    const high = rowsAsc[i + 1]!;
    if (strike >= low.strike && strike <= high.strike) {
      const t = (strike - low.strike) / (high.strike - low.strike);
      const yLow = yForRowIndex(rowIndexByStrike.get(low.strike) ?? i);
      const yHigh = yForRowIndex(rowIndexByStrike.get(high.strike) ?? i + 1);
      return yLow + (yHigh - yLow) * t;
    }
  }
  return null;
}

export function GexProfileChart({
  snapshot,
}: {
  snapshot: BoundedGammaProviderSnapshot;
}) {
  const profileRows = selectProfileStrikeRows(snapshot);
  if (profileRows.length === 0) {
    return (
      <p className="desk-section-note" data-testid="gex-profile-empty">
        No strike-level GEX to chart.
      </p>
    );
  }

  const displayRows = [...profileRows].sort((a, b) => b.strike - a.strike);
  const rowsAsc = [...profileRows].sort((a, b) => a.strike - b.strike);
  const rowIndexByStrike = new Map(
    displayRows.map((row, index) => [row.strike, index]),
  );

  const maxAbsGex = Math.max(
    ...profileRows.map((r) => Math.abs(r.netGex)),
    1,
  );

  const innerW = WIDTH - PAD.left - PAD.right;
  const midX = PAD.left + innerW / 2;
  const scaleX = innerW / 2 / maxAbsGex;
  const height = PAD.top + displayRows.length * ROW_H + PAD.bottom;
  const chartRight = WIDTH - PAD.right;

  const callWall =
    snapshot.boundedCallWall.status !== "unavailable" &&
    snapshot.boundedCallWall.strike !== undefined
      ? snapshot.boundedCallWall.strike
      : null;
  const putWall =
    snapshot.boundedPutWall.status !== "unavailable" &&
    snapshot.boundedPutWall.strike !== undefined
      ? snapshot.boundedPutWall.strike
      : null;
  const flipStrike = readGammaFlipStrike(snapshot);

  const spotY =
    snapshot.spot !== null
      ? interpolateStrikeY(snapshot.spot, rowsAsc, rowIndexByStrike)
      : null;
  const callWallY =
    callWall !== null
      ? interpolateStrikeY(callWall, rowsAsc, rowIndexByStrike)
      : null;
  const putWallY =
    putWall !== null
      ? interpolateStrikeY(putWall, rowsAsc, rowIndexByStrike)
      : null;
  const flipY =
    flipStrike !== null
      ? interpolateStrikeY(flipStrike, rowsAsc, rowIndexByStrike)
      : null;

  return (
    <div className="gex-profile-wrap" data-testid="gex-profile-chart">
      <svg
        className="gex-profile-svg"
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={`${snapshot.symbol} net GEX profile by strike`}
        preserveAspectRatio="xMidYMid meet"
      >
        <line
          className="gex-profile-zero"
          x1={midX}
          y1={PAD.top - 2}
          x2={midX}
          y2={height - PAD.bottom + 2}
        />

        {displayRows.map((row, index) => {
          const y = yForRowIndex(index);
          const barW = Math.abs(row.netGex) * scaleX;
          const x = row.netGex >= 0 ? midX : midX - barW;

          return (
            <g key={row.strike}>
              <text
                className="gex-profile-strike"
                x={PAD.left - 6}
                y={y + 3.5}
                textAnchor="end"
              >
                {row.strike}
              </text>
              <rect
                className={
                  row.netGex >= 0 ? "gex-profile-bar-pos" : "gex-profile-bar-neg"
                }
                x={x}
                y={y - ROW_H / 2 + 2}
                width={Math.max(barW, row.netGex !== 0 ? 0.6 : 0)}
                height={ROW_H - 4}
                rx={1}
              >
                <title>{`${row.strike}: net ${formatGexCompact(row.netGex)}`}</title>
              </rect>
            </g>
          );
        })}

        {putWallY !== null ? (
          <line
            className="gex-line-put"
            x1={PAD.left}
            y1={putWallY}
            x2={chartRight}
            y2={putWallY}
          />
        ) : null}
        {callWallY !== null ? (
          <line
            className="gex-line-call"
            x1={PAD.left}
            y1={callWallY}
            x2={chartRight}
            y2={callWallY}
          />
        ) : null}
        {flipY !== null ? (
          <line
            className="gex-line-flip"
            x1={PAD.left}
            y1={flipY}
            x2={chartRight}
            y2={flipY}
          />
        ) : null}
        {spotY !== null ? (
          <line
            className="gex-line-spot"
            x1={PAD.left}
            y1={spotY}
            x2={chartRight}
            y2={spotY}
          />
        ) : null}
      </svg>
    </div>
  );
}
