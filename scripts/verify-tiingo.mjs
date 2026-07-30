/**
 * M1-1 verification probe for the Tiingo path.
 *
 *   npm run verify:tiingo
 *
 * This answers questions that coverage documentation cannot: what the response
 * actually contains, which session date is really available at run time, and
 * whether adjusted and unadjusted closes diverge for these specific proxies.
 *
 * The token is read from the environment, sent as an Authorization header
 * rather than a query parameter so it cannot leak through a URL echoed in an
 * error, and redacted from every line this script prints.
 */

import { writeFileSync, mkdirSync } from "node:fs";

/** Tolerate a pasted `KEY= "value"`, so stray quotes are not sent as token characters. */
const TOKEN = (process.env.TIINGO_TOKEN ?? "").trim().replace(/^["']|["']$/g, "");

if (!TOKEN) {
  console.error(
    "TIINGO_TOKEN is empty. Put a token in .env (see .env.example) and re-run.\n" +
      "Nothing was requested, so no verification result should be recorded.",
  );
  process.exit(1);
}

/** Never let the token reach stdout, stderr or a written file. */
function redact(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.split(TOKEN).join("[REDACTED]");
}

function say(...parts) {
  console.log(redact(parts.join(" ")));
}

const ETFS = [
  { ticker: "gld", proxyFor: "GOLD" },
  { ticker: "cper", proxyFor: "COPPER" },
  { ticker: "uso", proxyFor: "OIL" },
  { ticker: "uup", proxyFor: "USD" },
];

const EXPECTED_DAILY_FIELDS = [
  "date",
  "close",
  "open",
  "high",
  "low",
  "volume",
  "adjClose",
  "adjOpen",
  "adjHigh",
  "adjLow",
  "adjVolume",
  "divCash",
  "splitFactor",
];

const LOOKBACK_DAYS = 75;
const today = new Date();
const startDate = new Date(today.getTime() - LOOKBACK_DAYS * 86_400_000)
  .toISOString()
  .slice(0, 10);
const endDate = today.toISOString().slice(0, 10);

/**
 * Applies the ingest validation rule established when Stooq returned an HTML
 * bot challenge under HTTP 200: never trust the status code alone.
 */
async function getJson(url, label) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Token ${TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  const contentType = response.headers.get("content-type") ?? "(none)";
  const body = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      reason: `HTTP ${response.status}`,
      contentType,
      preview: redact(body.slice(0, 200)),
    };
  }
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      reason: `content-type is ${contentType}, not JSON`,
      contentType,
      preview: redact(body.slice(0, 200)),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      ok: false,
      reason: "body is not parseable JSON",
      contentType,
      preview: redact(body.slice(0, 200)),
    };
  }

  say(`  ${label}: HTTP ${response.status}, content-type ${contentType}`);
  return { ok: true, data: parsed, contentType };
}

function maxRelativeDivergence(rows) {
  let worst = 0;
  let worstDate = null;
  for (const row of rows) {
    if (typeof row.close !== "number" || typeof row.adjClose !== "number") continue;
    if (row.close === 0) continue;
    const divergence = Math.abs(row.adjClose / row.close - 1);
    if (divergence > worst) {
      worst = divergence;
      worstDate = row.date;
    }
  }
  return { worst, worstDate };
}

const sessionsBySymbol = {};
const failures = [];

say(`Requesting ${startDate} .. ${endDate}\n`);

for (const { ticker, proxyFor } of ETFS) {
  say(`${ticker.toUpperCase()} (proxy for ${proxyFor})`);
  const url =
    `https://api.tiingo.com/tiingo/daily/${ticker}/prices` +
    `?startDate=${startDate}&endDate=${endDate}`;

  const result = await getJson(url, "response");
  if (!result.ok) {
    say(`  FAILED: ${result.reason}`);
    say(`  preview: ${result.preview}`);
    failures.push(`${ticker}: ${result.reason}`);
    say("");
    continue;
  }

  const rows = result.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    say("  FAILED: expected a non-empty array");
    failures.push(`${ticker}: empty payload`);
    say("");
    continue;
  }

  const fields = Object.keys(rows[0]).sort();
  const missing = EXPECTED_DAILY_FIELDS.filter((f) => !fields.includes(f));
  const unexpected = fields.filter((f) => !EXPECTED_DAILY_FIELDS.includes(f));

  const dates = rows.map((r) => String(r.date));
  const sessions = dates.map((d) => d.slice(0, 10));
  sessionsBySymbol[ticker] = sessions;

  const { worst, worstDate } = maxRelativeDivergence(rows);
  const withDiv = rows.filter((r) => Number(r.divCash) !== 0).length;
  const withSplit = rows.filter((r) => Number(r.splitFactor) !== 1).length;
  const nonPositive = rows.filter(
    (r) => !Number.isFinite(r.close) || Number(r.close) <= 0,
  ).length;

  say(`  rows: ${rows.length}`);
  say(`  fields: ${fields.join(", ")}`);
  say(`  missing expected: ${missing.length ? missing.join(", ") : "none"}`);
  say(`  unexpected: ${unexpected.length ? unexpected.join(", ") : "none"}`);
  say(`  raw date format: ${JSON.stringify(rows.at(-1).date)}`);
  say(`  first session: ${sessions[0]}   last session: ${sessions.at(-1)}`);
  say(`  close vs adjClose max divergence: ${(worst * 100).toFixed(4)}% ${worstDate ? `at ${worstDate}` : ""}`);
  say(`  rows with divCash: ${withDiv}   with splitFactor != 1: ${withSplit}`);
  say(`  non-positive or non-finite closes: ${nonPositive}`);
  say("");
}

say("BTCUSD (crypto endpoint)");
const cryptoUrl =
  "https://api.tiingo.com/tiingo/crypto/prices" +
  `?tickers=btcusd&resampleFreq=1day&startDate=${startDate}&endDate=${endDate}`;
const crypto = await getJson(cryptoUrl, "response");

if (!crypto.ok) {
  say(`  FAILED: ${crypto.reason}`);
  say(`  preview: ${crypto.preview}`);
  failures.push(`btcusd: ${crypto.reason}`);
} else {
  const series = Array.isArray(crypto.data) ? crypto.data[0] : null;
  const bars = series?.priceData ?? [];
  if (bars.length === 0) {
    say("  FAILED: no priceData returned");
    failures.push("btcusd: empty priceData");
  } else {
    say(`  envelope fields: ${Object.keys(series).sort().join(", ")}`);
    say(`  bar fields: ${Object.keys(bars[0]).sort().join(", ")}`);
    say(`  bars: ${bars.length}`);
    // The bar timestamp decides whether a 16:00 ET snap is even definable.
    say(`  raw first date: ${JSON.stringify(bars[0].date)}`);
    say(`  raw last date: ${JSON.stringify(bars.at(-1).date)}`);
    const weekendBars = bars.filter((b) => {
      const day = new Date(b.date).getUTCDay();
      return day === 0 || day === 6;
    }).length;
    say(`  weekend bars: ${weekendBars} (BTC trades daily; these must be dropped to align to equity sessions)`);
    sessionsBySymbol.btcusd = bars.map((b) => String(b.date).slice(0, 10));
  }
}

say("");

if (failures.length > 0) {
  say(`FAILED: ${failures.length} probe(s) did not verify`);
  for (const failure of failures) say(`  - ${failure}`);
  process.exit(1);
}

// Persist only the session dates, so the market calendar can be reconciled
// against a second independent source in an offline test.
const equitySessions = ETFS.map(({ ticker }) => sessionsBySymbol[ticker]).filter(
  Boolean,
);
const intersection = equitySessions.reduce((acc, list) =>
  acc.filter((d) => list.includes(d)),
);

mkdirSync("fixtures/macro", { recursive: true });
const fixturePath = "fixtures/macro/observed-sessions.tiingo.json";
writeFileSync(
  fixturePath,
  JSON.stringify(
    {
      source: "Tiingo daily prices",
      note: "Session dates only. Recorded so the market calendar can be reconciled offline against a second source.",
      retrievedAt: new Date().toISOString(),
      range: { startDate, endDate },
      symbols: ETFS.map((e) => e.ticker),
      sessions: intersection,
    },
    null,
    2,
  ) + "\n",
);

say(`All probes verified. Session dates written to ${fixturePath}`);
say(`Sessions common to all four ETFs: ${intersection.length}`);
