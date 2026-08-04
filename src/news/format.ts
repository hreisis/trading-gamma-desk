import type { MarketNewsItem } from "@/contracts/market-news";

export function formatNewsTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function newsSourceLabel(
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

export function newsItemSourceLabel(
  source: MarketNewsItem["itemSource"],
): string {
  switch (source) {
    case "alpaca":
      return "Live";
    case "synthetic_demo":
      return "Fixture";
    case "unavailable":
      return "Unavailable";
  }
}
