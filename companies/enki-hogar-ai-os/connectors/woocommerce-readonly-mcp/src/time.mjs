import {ENKI_TIMEZONE} from "./evidence.mjs";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const madridFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ENKI_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function parseLocalDate(value) {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error("Use a real calendar date in YYYY-MM-DD format");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new Error("Use a real calendar date in YYYY-MM-DD format");
  }
  return {year, month, day};
}

function timezoneOffsetMilliseconds(instant) {
  const parts = Object.fromEntries(
    madridFormatter.formatToParts(instant)
      .filter(({type}) => type !== "literal")
      .map(({type, value}) => [type, Number(value)]),
  );
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return representedAsUtc - instant.getTime();
}

export function madridMidnightUtc(value) {
  const {year, month, day} = parseLocalDate(value);
  const localAsUtc = Date.UTC(year, month - 1, day);
  let candidate = new Date(localAsUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    candidate = new Date(localAsUtc - timezoneOffsetMilliseconds(candidate));
  }
  return candidate;
}

export function nextLocalDate(value) {
  const {year, month, day} = parseLocalDate(value);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function madridPeriodParams(startDate, endDate) {
  const start = madridMidnightUtc(startDate);
  const end = madridMidnightUtc(endDate);
  if (start.getTime() > end.getTime()) throw new Error("start_date must not be after end_date");
  const exclusiveEnd = madridMidnightUtc(nextLocalDate(endDate));
  return {
    after: start.toISOString(),
    before: new Date(exclusiveEnd.getTime() - 1).toISOString(),
  };
}
