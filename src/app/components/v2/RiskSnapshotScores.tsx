"use client";

import { useEffect } from "react";

function highBetaTilt(riskDivergence: number | null): number {
  if (riskDivergence == null || !Number.isFinite(riskDivergence)) return 0;
  if (riskDivergence >= 15) return -5;
  if (riskDivergence >= 5) return -2;
  if (riskDivergence <= -15) return 5;
  if (riskDivergence <= -5) return 2;
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function RiskSnapshotScores({
  spyScore,
  qqqScore,
  baseHighBeta,
  riskDivergence,
}: {
  spyScore: number | null;
  qqqScore: number | null;
  baseHighBeta: number | null;
  riskDivergence: number | null;
}) {
  useEffect(() => {
    const body = document.querySelector<HTMLElement>(".mk-risk-snapshot .mk-snapshot-body");
    if (!body) return;

    const existing = body.querySelector<HTMLElement>("[data-risk-snapshot-scores]");
    existing?.remove();

    const spreadValue = body.querySelector<HTMLElement>(":scope > strong");
    if (!spreadValue) return;

    const row = document.createElement("div");
    row.dataset.riskSnapshotScores = "true";
    row.style.display = "flex";
    row.style.justifyContent = "center";
    row.style.gap = "18px";
    row.style.fontSize = "11px";
    row.style.fontWeight = "700";
    row.style.color = "#6e7890";
    row.style.marginTop = "-2px";
    row.innerHTML = `<span>QQQ <b style="color:#142347">${qqqScore ?? "—"}</b></span><span>SPY <b style="color:#142347">${spyScore ?? "—"}</b></span>`;
    body.insertBefore(row, spreadValue);

    const highBetaLine = body.querySelector<HTMLElement>(":scope > small");
    const tilt = highBetaTilt(riskDivergence);
    const action = tilt > 0 ? "ADD" : tilt < 0 ? "TRIM" : "HOLD";
    const actionColor = tilt > 0 ? "#0b9b55" : tilt < 0 ? "#ef3e43" : "#78849a";
    const finalTarget = baseHighBeta == null ? null : Math.round(clamp(baseHighBeta + tilt, 0, 100));

    if (highBetaLine) {
      highBetaLine.innerHTML = `High Beta: <em style="font-style:normal;font-weight:800;color:${actionColor}">${action}</em>${finalTarget == null ? "" : ` · Target ${finalTarget}%`}`;
    }

    return () => row.remove();
  }, [spyScore, qqqScore, baseHighBeta, riskDivergence]);

  return null;
}
