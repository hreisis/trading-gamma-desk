"use client";

import { useEffect } from "react";

function applyRiskNeedle() {
  const gauge = document.querySelector<HTMLElement>(".pv-gauge");
  const scoreNode = gauge?.querySelector<HTMLElement>(":scope > b");
  if (!gauge || !scoreNode) return;

  const score = Number(scoreNode.textContent?.trim());
  if (!Number.isFinite(score)) {
    gauge.style.removeProperty("--risk-angle");
    gauge.dataset.pointer = "off";
    return;
  }

  const bounded = Math.max(0, Math.min(100, score));
  // Gauge spans left (0) -> top (50) -> right (100).
  // CSS needle points right at 0deg, so map score into -180deg -> 0deg.
  const angle = -180 + bounded * 1.8;
  gauge.style.setProperty("--risk-angle", `${angle}deg`);
  gauge.dataset.pointer = "on";
}

export function RiskGaugeEnhancer() {
  useEffect(() => {
    applyRiskNeedle();
    const observer = new MutationObserver(applyRiskNeedle);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
