"use client";

import { useEffect } from "react";

export function RiskSnapshotScores({
  spyScore,
  qqqScore,
}: {
  spyScore: number | null;
  qqqScore: number | null;
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
    return () => row.remove();
  }, [spyScore, qqqScore]);

  return null;
}
