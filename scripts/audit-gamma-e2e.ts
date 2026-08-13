/**
 * End-to-end gamma correctness audit: snapshot → desk view → UI-shaped summary.
 * Usage: npx tsx scripts/audit-gamma-e2e.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BoundedGammaProviderSnapshot } from "@/contracts";
import { resolveBoundedGammaTargetSession } from "@/desk/bounded-gamma-freshness";
import {
  boundedGammaFreshnessLabel,
  wallStrikeWhenAvailable,
} from "@/desk/bounded-gamma-freshness";
import { loadBoundedGammaDeskView } from "@/desk/load-bounded-gamma";
import {
  dealerFlowRegimeLabel,
  formatGexCompact,
  formatOptionsDataCloseLabel,
  gammaRegimeLabel,
  readGammaFlipStrike,
} from "@/desk/format-gamma";
import { deriveCallWall, derivePutWall } from "@/gamma/aggregate";
import { boundedGammaLatestPath } from "@/gamma/marketdata-app/paths";

interface FieldAudit {
  field: string;
  rawSource: string;
  snapshot: string;
  ui: string;
  match: boolean;
  issue: string;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  return String(v);
}

function auditSymbol(symbol: "SPY" | "QQQ", now: Date): FieldAudit[] {
  const dataRoot = join(process.cwd(), "data", "gamma", "providers", "marketdata-app");
  const path = boundedGammaLatestPath(symbol, dataRoot);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const snapshot = BoundedGammaProviderSnapshot.parse(raw);
  const targetSession = resolveBoundedGammaTargetSession(now);

  const view = loadBoundedGammaDeskView({
    symbol,
    dataRoot,
    now,
    targetSession,
  });

  const deskSnapshot = view.snapshot;
  if (!deskSnapshot) {
    return [
      {
        field: "snapshot load",
        rawSource: path,
        snapshot: "—",
        ui: view.status,
        match: false,
        issue: view.error?.message ?? "no snapshot after session gate",
      },
    ];
  }

  const byStrikeSum = deskSnapshot.byStrike.reduce((s, r) => s + r.netGex, 0);
  const derivedCall = deriveCallWall(deskSnapshot.byStrike);
  const derivedPut = derivePutWall(deskSnapshot.byStrike);

  const showFlow =
    deskSnapshot.status === "incomplete" || deskSnapshot.status === "available";
  const uiSpot = deskSnapshot.spot; // no Alpaca in audit — matches EOD chain spot
  const uiCallWall = showFlow
    ? wallStrikeWhenAvailable(deskSnapshot.boundedCallWall)
    : null;
  const uiPutWall = showFlow
    ? wallStrikeWhenAvailable(deskSnapshot.boundedPutWall)
    : null;
  const uiFlip = showFlow ? readGammaFlipStrike(deskSnapshot) : null;
  const uiNetGex = showFlow ? deskSnapshot.totalGex : null;
  const uiRegime = showFlow ? deskSnapshot.gammaRegime : null;
  const uiDealerFlow = uiRegime ? dealerFlowRegimeLabel(uiRegime) : null;
  const uiDataLabel = formatOptionsDataCloseLabel(
    deskSnapshot.sessionDate,
    view.isFixture,
  );
  const uiFreshness = view.freshness ?? "—";
  const uiStatus = view.status;

  const iv = deskSnapshot.representativeIv;
  const rows: FieldAudit[] = [];

  const push = (
    field: string,
    rawSource: string,
    snapVal: unknown,
    uiVal: unknown,
    match: boolean,
    issue: string,
  ) => {
    rows.push({
      field,
      rawSource,
      snapshot: fmt(snapVal),
      ui: fmt(uiVal),
      match,
      issue,
    });
  };

  push(
    "spot",
    `chain.spot from vendor underlying at normalize (vendorAsOf ${snapshot.vendorAsOf})`,
    snapshot.spot,
    uiSpot,
    snapshot.spot === uiSpot,
    uiSpot !== snapshot.spot
      ? "live Alpaca overlay would replace EOD spot without this audit"
      : "EOD spot; live quote overlay not applied in audit",
  );

  push(
    "sessionDate",
    `sessionDateFromIso(vendorUpdatedMax); vendorUpdatedMax=${snapshot.vendorUpdatedMax}`,
    snapshot.sessionDate,
    deskSnapshot.sessionDate,
    snapshot.sessionDate === deskSnapshot.sessionDate,
    "",
  );

  push(
    "vendorAsOf / asOf",
    `chain.asOf = max(contract updated); representativeIv.asOf`,
    `${snapshot.vendorAsOf} / iv.asOf=${iv?.asOf ?? "—"}`,
    uiDataLabel,
    uiDataLabel?.includes(snapshot.sessionDate.slice(5, 7) ? "Aug" : "") ?? false,
    `UI shows session close label, not raw ISO`,
  );

  push(
    "expiration / DTE",
    `fetch input expiration=${snapshot.expiration}, dte=${snapshot.dte}`,
    `${snapshot.expiration} (${snapshot.dte} DTE)`,
    snapshot.expiration,
    true,
    snapshot.dte === 1 ? "1-DTE bounded expiry (not 0DTE)" : "",
  );

  const callSnap = snapshot.boundedCallWall;
  const callMatch =
    (derivedCall.status === "available" &&
      callSnap.status === "available" &&
      derivedCall.strike === callSnap.strike) ||
    (derivedCall.status === "available" &&
      callSnap.status === "incomplete" &&
      derivedCall.strike === callSnap.strike);
  push(
    "Call Wall",
    `max callGex>0 on byStrike; tie lowest strike. derived gex=${derivedCall.status === "available" ? derivedCall.gex : "—"}`,
    `${callSnap.status} strike=${callSnap.strike ?? "—"} gex=${callSnap.gex ?? "—"}`,
    uiCallWall,
    callMatch && uiCallWall === (callSnap.strike ?? null),
    callSnap.status === "incomplete"
      ? "incomplete — suspect greeks excluded on call side"
      : "",
  );

  const putSnap = snapshot.boundedPutWall;
  const putMatch =
    (derivedPut.status === "available" &&
      putSnap.status === "available" &&
      derivedPut.strike === putSnap.strike) ||
    (derivedPut.status === "available" &&
      putSnap.status === "incomplete" &&
      derivedPut.strike === putSnap.strike);
  push(
    "Put Wall",
    `min putGex<0 on byStrike; tie highest strike. derived gex=${derivedPut.status === "available" ? derivedPut.gex : "—"}`,
    `${putSnap.status} strike=${putSnap.strike ?? "—"} gex=${putSnap.gex ?? "—"}`,
    uiPutWall,
    putMatch && uiPutWall === (putSnap.strike ?? null),
    putSnap.status === "incomplete"
      ? "incomplete — suspect greeks excluded on put side"
      : "",
  );

  const flip = snapshot.gammaFlip;
  push(
    "Gamma Flip",
    `spot-shock BS gamma on same used contracts; scope=${flip.scope ?? "bounded"}`,
    flip.status === "available"
      ? `strike=${flip.strike} method=${flip.method}`
      : flip.status,
    uiFlip,
    uiFlip === (flip.status === "available" ? flip.strike : null),
    "same contract set as aggregate; not strike-GEX interpolation",
  );

  push(
    "Net GEX (totalGex)",
    `Σ used contract gex; byStrike ΣnetGex=${byStrikeSum.toFixed(2)}`,
    snapshot.totalGex,
    uiNetGex,
    Math.abs((snapshot.totalGex ?? 0) - byStrikeSum) < 0.01 &&
      uiNetGex === snapshot.totalGex,
    `grossGex=${snapshot.grossGex}; sign ${snapshot.totalGex && snapshot.totalGex > 0 ? "positive" : "negative"}`,
  );

  push(
    "gamma regime",
    `deriveGammaRegime(totalGex, byStrike); |total|/gross threshold`,
    `${snapshot.gammaRegime} (${gammaRegimeLabel(snapshot.gammaRegime)})`,
    uiRegime,
    uiRegime === snapshot.gammaRegime,
    "",
  );

  push(
    "dealer flow label",
    "dealerFlowRegimeLabel(gammaRegime)",
    snapshot.gammaRegime,
    uiDealerFlow,
    true,
    uiDealerFlow ?? "",
  );

  if (!iv) {
    push(
      "representative IV",
      "extractRepresentativeIvFromChain",
      "—",
      "—",
      true,
      "missing iv field",
    );
  } else {
    push(
      "representative IV",
      "extractRepresentativeIvFromChain (ATM/near-spot contracts)",
      iv.status === "available"
        ? `${(iv.value! * 100).toFixed(2)}% session=${iv.sessionDate}`
        : iv.status,
      iv.status === "available" ? `${(iv.value! * 100).toFixed(1)}%` : "—",
      iv.sessionDate === snapshot.sessionDate,
      "",
    );
  }

  push(
    "freshness / desk status",
    `boundedGammaFreshnessLabel; snapshot.status=${snapshot.status}`,
    `${boundedGammaFreshnessLabel(snapshot, targetSession)} / ${snapshot.status}`,
    `${uiFreshness} / ${uiStatus}`,
    view.freshness === boundedGammaFreshnessLabel(snapshot, targetSession),
    snapshot.status === "incomplete"
      ? "incomplete — 13 suspect vendor greeks; walls marked incomplete"
      : "",
  );

  push(
    "scope / limitations",
    "BOUNDED single-expiry; walls are boundedCallWall/boundedPutWall only",
    snapshot.scope,
    `quality string cites bounded single expiry`,
    true,
    snapshot.limitations[0] ?? "",
  );

  return rows;
}

function main() {
  const now = new Date();
  console.log("=== Gamma E2E audit ===");
  console.log("now:", now.toISOString());
  console.log("targetSession:", resolveBoundedGammaTargetSession(now));
  console.log(
    "note: raw MarketData.app chain is not persisted; audit re-derives walls from snapshot.byStrike",
  );

  for (const symbol of ["SPY", "QQQ"] as const) {
    console.log(`\n######## ${symbol} ########`);
    const rows = auditSymbol(symbol, now);
    for (const row of rows) {
      console.log(
        [
          row.field,
          row.match ? "MATCH" : "MISMATCH",
          `snapshot=${row.snapshot}`,
          `ui=${row.ui}`,
          row.issue ? `(${row.issue})` : "",
        ].join(" | "),
      );
    }
    console.log("\n--- table ---");
    console.log("field | raw/source | snapshot | UI | match? | issue");
    for (const row of rows) {
      console.log(
        `${row.field} | ${row.rawSource.slice(0, 60)} | ${row.snapshot} | ${row.ui} | ${row.match ? "yes" : "NO"} | ${row.issue}`,
      );
    }
  }
}

main();
