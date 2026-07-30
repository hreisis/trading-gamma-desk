import { BLS_SCHEDULE_TIMEZONE, zonedLocalToUtc } from "./timezone";
import { toUtcIsoZ } from "./time";

export interface IcsEvent {
  readonly uid: string | null;
  readonly summary: string;
  readonly description: string | null;
  readonly url: string | null;
  readonly dtStartRaw: string;
  readonly occurredAtUtc: string;
}

/** RFC 5545 line unfolding: continuation lines start with SPACE or TAB. */
export function unfoldIcs(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (
      (line.startsWith(" ") || line.startsWith("\t")) &&
      out.length > 0
    ) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Unescape ICS TEXT (RFC 5545 §3.3.11). */
export function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function splitProperty(line: string): { name: string; params: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const semi = left.indexOf(";");
  if (semi < 0) {
    return { name: left.toUpperCase(), params: "", value };
  }
  return {
    name: left.slice(0, semi).toUpperCase(),
    params: left.slice(semi + 1),
    value,
  };
}

/**
 * Parse DTSTART into UTC ISO Z.
 * - With Z or ±offset → Date.parse
 * - Floating local → America/New_York (BLS schedule convention)
 */
export function parseIcsDateTimeToUtc(
  rawValue: string,
  params: string,
): string | null {
  const value = rawValue.trim();
  if (!value) return null;

  if (/VALUE=DATE/i.test(params) || /^\d{8}$/.test(value)) {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(4, 6));
    const d = Number(value.slice(6, 8));
    if (![y, m, d].every(Number.isFinite)) return null;
    // Date-only releases: treat as 08:30 Eastern (typical BLS window).
    return zonedLocalToUtc(y, m, d, 8, 30, 0, BLS_SCHEDULE_TIMEZONE).toISOString();
  }

  // ISO-ish with separators already
  if (value.includes("-") || value.includes(":")) {
    return toUtcIsoZ(value);
  }

  const m = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i,
  );
  if (!m) return toUtcIsoZ(value);

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const zulu = Boolean(m[7]);

  if (zulu) {
    return new Date(
      Date.UTC(year, month - 1, day, hour, minute, second),
    ).toISOString();
  }

  return zonedLocalToUtc(
    year,
    month,
    day,
    hour,
    minute,
    second,
    BLS_SCHEDULE_TIMEZONE,
  ).toISOString();
}

/** Extract VEVENT blocks from an ICS body. */
export function parseIcsEvents(body: string): IcsEvent[] {
  const lines = unfoldIcs(body);
  const events: IcsEvent[] = [];
  let inEvent = false;
  let uid: string | null = null;
  let summary: string | null = null;
  let description: string | null = null;
  let url: string | null = null;
  let dtStartRaw: string | null = null;
  let dtStartParams = "";

  const flush = (): void => {
    if (!summary || !dtStartRaw) return;
    const occurredAtUtc = parseIcsDateTimeToUtc(dtStartRaw, dtStartParams);
    if (!occurredAtUtc) return;
    events.push({
      uid,
      summary: unescapeIcsText(summary),
      description: description ? unescapeIcsText(description) : null,
      url,
      dtStartRaw,
      occurredAtUtc,
    });
  };

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      uid = null;
      summary = null;
      description = null;
      url = null;
      dtStartRaw = null;
      dtStartParams = "";
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent) flush();
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    const prop = splitProperty(line);
    if (!prop) continue;
    switch (prop.name) {
      case "UID":
        uid = prop.value.trim() || null;
        break;
      case "SUMMARY":
        summary = prop.value;
        break;
      case "DESCRIPTION":
        description = prop.value;
        break;
      case "URL":
        url = prop.value.trim() || null;
        break;
      case "DTSTART":
        dtStartRaw = prop.value.trim();
        dtStartParams = prop.params;
        break;
      default:
        break;
    }
  }

  return events;
}
