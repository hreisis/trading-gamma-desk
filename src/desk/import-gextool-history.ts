import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { defaultSessionCalendar } from "@/macro/calendar";
import {
  loadManualGammaSnapshot,
  ManualGammaSnapshot,
  ManualGammaSymbolInput,
  type ManualGammaSnapshot as ManualGammaSnapshotType,
  type ManualGammaSymbolInput as ManualGammaSymbolInputType,
} from "./manual-gamma";
import { writeJson, type RuntimeJsonStore } from "./runtime-store";

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const EXPECTED_HEADERS = [
  "Time (ET)",
  "Spot",
  "Net GEX",
  "Flip",
  "Call wall",
  "Put wall",
  "IV30",
] as const;

export interface GexToolObservation {
  readonly sessionDate: string;
  readonly observedCalendarDate: string;
  readonly priceAsOfEt: string;
  readonly observedAtMs: number;
  readonly symbol: ManualGammaSymbolInputType;
}

export interface GexToolImportSkip {
  readonly sessionDate: string;
  readonly reason: string;
}

export interface GexToolImportResult {
  readonly generated: readonly string[];
  readonly skipped: readonly GexToolImportSkip[];
  readonly removed: readonly string[];
  readonly snapshots: readonly ManualGammaSnapshotType[];
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

function isMissingToken(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed === "—" || trimmed === "-" || trimmed === "–";
}

function parseNumber(raw: string): number | null {
  if (isMissingToken(raw)) return null;
  const normalized = raw.replace(/,/g, "").trim();
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function parseNetGexToBillions(raw: string): number | null {
  const trimmed = raw.trim().replace(/[\u2212\u2013\u2014]/g, "-");
  if (trimmed === "$0" || trimmed === "0") return 0;
  const match = trimmed.match(/^(-)?\$?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*([BM])$/i);
  if (!match?.[2] || !match[3]) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const magnitude = Number(match[2].replace(/,/g, ""));
  if (!Number.isFinite(magnitude)) return null;
  const unit = match[3].toUpperCase();
  const billions = unit === "B" ? magnitude : magnitude / 1_000;
  return sign * billions;
}

export function parseIv30Pct(raw: string): number | null {
  if (isMissingToken(raw)) return null;
  const match = raw.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*%$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatEtParts(
  year: number,
  monthIndex: number,
  day: number,
  hour24: number,
  minute: number,
): { calendarDate: string; priceAsOfEt: string; observedAtMs: number } {
  const month = String(monthIndex + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const hh = String(hour24).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  const calendarDate = `${year}-${month}-${dd}`;
  const priceAsOfEt = `${calendarDate}T${hh}:${mm}`;
  const observedAtMs = Date.parse(
    `${calendarDate}T${hh}:${mm}:00-04:00`,
  );
  return { calendarDate, priceAsOfEt, observedAtMs };
}

/** Map a GEXTool calendar stamp onto the last completed US equity session. */
export function mapGexToolObservedDateToMarketSession(
  observedCalendarDate: string,
): string | null {
  if (defaultSessionCalendar.isSession(observedCalendarDate)) {
    return observedCalendarDate;
  }
  return defaultSessionCalendar.previousSession(observedCalendarDate);
}

export function parseGexToolTime(
  raw: string,
  now: Date,
): {
  sessionDate: string;
  observedCalendarDate: string;
  priceAsOfEt: string;
  observedAtMs: number;
} | null {
  const match = raw
    .trim()
    .match(/^([A-Za-z]{3}) (\d{1,2}), (\d{1,2}):(\d{2}) (AM|PM) ET$/);
  if (!match) return null;
  const monthIndex = match[1] ? MONTHS[match[1]] : undefined;
  if (monthIndex === undefined) return null;
  const day = Number(match[2]);
  let hour = Number(match[3]);
  const minute = Number(match[4]);
  const meridiem = match[5];
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59 || day < 1 || day > 31) {
    return null;
  }
  if (meridiem === "AM") {
    hour = hour === 12 ? 0 : hour;
  } else {
    hour = hour === 12 ? 12 : hour + 12;
  }

  const currentYear = now.getUTCFullYear();
  let year = currentYear;
  let parsed = formatEtParts(year, monthIndex, day, hour, minute);
  if (parsed.observedAtMs > now.getTime() + 24 * 60 * 60 * 1000) {
    year -= 1;
    parsed = formatEtParts(year, monthIndex, day, hour, minute);
  }
  const sessionDate = mapGexToolObservedDateToMarketSession(parsed.calendarDate);
  if (!sessionDate) return null;
  return {
    sessionDate,
    observedCalendarDate: parsed.calendarDate,
    priceAsOfEt: parsed.priceAsOfEt,
    observedAtMs: parsed.observedAtMs,
  };
}

function parseObservation(fields: readonly string[], now: Date): GexToolObservation | null {
  if (fields.length < 7) return null;
  const time = parseGexToolTime(fields[0] ?? "", now);
  const spot = parseNumber(fields[1] ?? "");
  const netGexBillions = parseNetGexToBillions(fields[2] ?? "");
  const gammaFlip = parseNumber(fields[3] ?? "");
  const callWall = parseNumber(fields[4] ?? "");
  const putWall = parseNumber(fields[5] ?? "");
  const iv30Pct = parseIv30Pct(fields[6] ?? "");
  if (
    !time ||
    spot === null ||
    netGexBillions === null ||
    gammaFlip === null ||
    callWall === null ||
    putWall === null ||
    iv30Pct === null
  ) {
    return null;
  }
  const symbolParsed = ManualGammaSymbolInput.safeParse({
    spot,
    netGexBillions,
    gammaFlip,
    callWall,
    putWall,
    iv30Pct,
  });
  if (!symbolParsed.success) return null;
  return {
    sessionDate: time.sessionDate,
    observedCalendarDate: time.observedCalendarDate,
    priceAsOfEt: time.priceAsOfEt,
    observedAtMs: time.observedAtMs,
    symbol: symbolParsed.data,
  };
}

export function parseGexToolCsv(
  csvText: string,
  now: Date = new Date(),
): {
  readonly observations: readonly GexToolObservation[];
  readonly droppedRows: number;
} {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { observations: [], droppedRows: 0 };
  const headers = parseCsvLine(lines[0] ?? "");
  if (headers.length < EXPECTED_HEADERS.length) {
    throw new Error("GEXTool CSV is missing expected headers.");
  }
  for (const [index, expected] of EXPECTED_HEADERS.entries()) {
    if ((headers[index] ?? "").trim() !== expected) {
      throw new Error(`GEXTool CSV header mismatch at column ${index + 1}: expected ${expected}.`);
    }
  }

  const byDate = new Map<string, GexToolObservation>();
  let droppedRows = 0;
  for (const line of lines.slice(1)) {
    const observation = parseObservation(parseCsvLine(line), now);
    if (!observation) {
      droppedRows += 1;
      continue;
    }
    const previous = byDate.get(observation.sessionDate);
    if (!previous || observation.observedAtMs >= previous.observedAtMs) {
      byDate.set(observation.sessionDate, observation);
    }
  }
  return {
    observations: [...byDate.values()],
    droppedRows,
  };
}

function laterPriceAsOf(left: string, right: string): string {
  return left >= right ? left : right;
}

function snapshotNotes(
  sessionDate: string,
  spy: GexToolObservation,
  qqq: GexToolObservation,
): string {
  const mapped =
    spy.observedCalendarDate !== sessionDate ||
    qqq.observedCalendarDate !== sessionDate;
  const observed = `SPY GEXTool ${spy.priceAsOfEt} ET (${spy.observedCalendarDate}); QQQ GEXTool ${qqq.priceAsOfEt} ET (${qqq.observedCalendarDate}).`;
  if (!mapped) {
    return `Imported from GEXTool history CSVs. ${observed}`;
  }
  return `Imported from GEXTool history CSVs. Non-session observation(s) mapped onto ${sessionDate}. ${observed}`;
}

export function mergeGexToolHistory(input: {
  readonly spy: readonly GexToolObservation[];
  readonly qqq: readonly GexToolObservation[];
  readonly source?: string;
  readonly notes?: string;
  readonly savedAt?: Date;
}): {
  readonly snapshots: readonly ManualGammaSnapshotType[];
  readonly skipped: readonly GexToolImportSkip[];
  readonly mappedSessions: readonly string[];
} {
  const spyByDate = new Map(input.spy.map((row) => [row.sessionDate, row]));
  const qqqByDate = new Map(input.qqq.map((row) => [row.sessionDate, row]));
  const dates = [...new Set([...spyByDate.keys(), ...qqqByDate.keys()])].sort();
  const skipped: GexToolImportSkip[] = [];
  const snapshots: ManualGammaSnapshotType[] = [];
  const mappedSessions: string[] = [];
  const savedAt = (input.savedAt ?? new Date()).toISOString();
  const source = input.source ?? "GEXTool";

  for (const sessionDate of dates) {
    const spy = spyByDate.get(sessionDate);
    const qqq = qqqByDate.get(sessionDate);
    if (!spy || !qqq) {
      skipped.push({
        sessionDate,
        reason: !spy ? "missing SPY" : "missing QQQ",
      });
      continue;
    }
    const snapshot = ManualGammaSnapshot.safeParse({
      kind: "ManualGammaSnapshot",
      schemaVersion: "0.1.0",
      marketSessionDate: sessionDate,
      savedAt,
      source,
      priceAsOfEt: laterPriceAsOf(spy.priceAsOfEt, qqq.priceAsOfEt),
      oiAsOf: sessionDate,
      notes: snapshotNotes(sessionDate, spy, qqq),
      symbols: {
        SPY: spy.symbol,
        QQQ: qqq.symbol,
      },
    });
    if (!snapshot.success) {
      skipped.push({ sessionDate, reason: "invalid snapshot fields" });
      continue;
    }
    if (
      spy.observedCalendarDate !== sessionDate ||
      qqq.observedCalendarDate !== sessionDate
    ) {
      mappedSessions.push(sessionDate);
    }
    snapshots.push(snapshot.data);
  }

  return { snapshots, skipped, mappedSessions };
}

export async function importGexToolHistoryFiles(input: {
  readonly spyCsvPath: string;
  readonly qqqCsvPath: string;
  readonly store: RuntimeJsonStore;
  readonly force?: boolean;
  readonly now?: Date;
}): Promise<GexToolImportResult> {
  const now = input.now ?? new Date();
  const spyParsed = parseGexToolCsv(readFileSync(input.spyCsvPath, "utf8"), now);
  const qqqParsed = parseGexToolCsv(readFileSync(input.qqqCsvPath, "utf8"), now);
  const merged = mergeGexToolHistory({
    spy: spyParsed.observations,
    qqq: qqqParsed.observations,
    savedAt: now,
  });

  const generated: string[] = [];
  const skipped: GexToolImportSkip[] = [...merged.skipped];
  const written: ManualGammaSnapshotType[] = [];
  const mapped = new Set(merged.mappedSessions);

  for (const snapshot of merged.snapshots) {
    const existing = await loadManualGammaSnapshot(
      input.store,
      snapshot.marketSessionDate,
    );
    const overwriteMapped = mapped.has(snapshot.marketSessionDate);
    if (existing && !input.force && !overwriteMapped) {
      skipped.push({
        sessionDate: snapshot.marketSessionDate,
        reason: "existing valid snapshot",
      });
      continue;
    }
    const saved = await writeJson(
      input.store,
      `manual-gamma/${snapshot.marketSessionDate}.json`,
      snapshot,
      { allowOverwrite: input.force === true || overwriteMapped },
    );
    if (!saved) {
      skipped.push({
        sessionDate: snapshot.marketSessionDate,
        reason: "existing file not overwritten",
      });
      continue;
    }
    generated.push(snapshot.marketSessionDate);
    written.push(snapshot);
  }

  const removed = removeNonSessionManualGammaFiles(input.store.rootLabel);

  return { generated, skipped, removed, snapshots: written };
}

function removeNonSessionManualGammaFiles(dataRoot: string): string[] {
  const removed: string[] = [];
  const dir = join(dataRoot, "manual-gamma");
  if (!existsSync(dir)) return removed;
  for (const name of readdirSync(dir)) {
    const match = name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match?.[1]) continue;
    const sessionDate = match[1];
    if (defaultSessionCalendar.isSession(sessionDate)) continue;
    unlinkSync(join(dir, name));
    removed.push(sessionDate);
  }
  return removed;
}
