import type { BoundedGammaProviderSnapshot } from "@/contracts";
import type { StrikeGexLevel } from "@/contracts/estimated-gamma";

function nearestStrikeRow(
  rows: readonly StrikeGexLevel[],
  strike: number,
): number {
  return rows.reduce((best, row) =>
    Math.abs(row.strike - strike) < Math.abs(best - strike) ? row.strike : best,
  rows[0]!.strike);
}

/**
 * UI-only strike window for the primary GEX profile.
 * Always includes spot, bounded walls, and top |netGex| concentrations.
 */
export function selectProfileStrikeRows(
  snapshot: BoundedGammaProviderSnapshot,
): StrikeGexLevel[] {
  const rows = [...snapshot.byStrike].sort((a, b) => a.strike - b.strike);
  if (rows.length === 0) return [];

  const anchors = new Set<number>();

  if (snapshot.spot !== null && Number.isFinite(snapshot.spot)) {
    anchors.add(nearestStrikeRow(rows, snapshot.spot));
  }
  if (
    snapshot.boundedCallWall.status !== "unavailable" &&
    snapshot.boundedCallWall.strike !== undefined
  ) {
    anchors.add(nearestStrikeRow(rows, snapshot.boundedCallWall.strike));
  }
  if (
    snapshot.boundedPutWall.status !== "unavailable" &&
    snapshot.boundedPutWall.strike !== undefined
  ) {
    anchors.add(nearestStrikeRow(rows, snapshot.boundedPutWall.strike));
  }

  const byMagnitude = [...rows].sort(
    (a, b) => Math.abs(b.netGex) - Math.abs(a.netGex),
  );
  for (const row of byMagnitude.slice(0, 10)) {
    anchors.add(row.strike);
  }

  const anchorList = [...anchors];
  const minAnchor = Math.min(...anchorList);
  const maxAnchor = Math.max(...anchorList);

  const pad = 4;
  let minStrike = minAnchor - pad;
  let maxStrike = maxAnchor + pad;

  let filtered = rows.filter(
    (r) => r.strike >= minStrike && r.strike <= maxStrike,
  );

  const maxRows = 42;
  if (filtered.length > maxRows) {
    const keep = new Set(anchorList);
    for (const row of byMagnitude.slice(0, 8)) {
      keep.add(row.strike);
    }
    const tightMin = Math.min(...keep) - 2;
    const tightMax = Math.max(...keep) + 2;
    filtered = rows.filter(
      (r) => r.strike >= tightMin && r.strike <= tightMax,
    );
  }

  return filtered;
}
