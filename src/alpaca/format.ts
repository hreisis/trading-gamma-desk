export function formatAlpacaPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: value >= 100 ? 2 : 4,
  });
}

export function formatAlpacaDailyChangePct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatAlpacaTimestamp(value: string | null): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function alpacaSourceLabel(
  source: "alpaca" | "synthetic_demo" | "unavailable",
): string {
  switch (source) {
    case "alpaca":
      return "Alpaca";
    case "synthetic_demo":
      return "Synthetic demo";
    case "unavailable":
      return "Unavailable";
  }
}
