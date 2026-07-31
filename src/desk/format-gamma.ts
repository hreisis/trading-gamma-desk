/** Compact GEX formatting for desk UI (amplifier/compressor units — not a price). */

export function formatGexCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function formatSpot(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

export function gammaRegimeLabel(
  regime: "positive" | "negative" | "near_zero" | "unavailable",
): string {
  switch (regime) {
    case "positive":
      return "Positive";
    case "negative":
      return "Negative";
    case "near_zero":
      return "Near zero";
    case "unavailable":
      return "Unavailable";
  }
}

export function gammaAvailabilityLabel(
  status: "available" | "incomplete" | "partial" | "unavailable",
): string {
  switch (status) {
    case "available":
      return "Available";
    case "incomplete":
      return "Incomplete";
    case "partial":
      return "Partial";
    case "unavailable":
      return "Unavailable";
  }
}

export function dteLabel(dte: number, zeroDteStatus: string): string {
  if (dte === 0 && zeroDteStatus !== "unavailable") {
    return "0DTE";
  }
  if (dte === 0) {
    return "0 DTE";
  }
  if (dte === 1) {
    return "1 DTE";
  }
  return `${dte} DTE`;
}
