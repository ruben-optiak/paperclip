#!/usr/bin/env node

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

if (!raw.trim()) {
  console.error("Expected Paperclip run-list JSON on stdin");
  process.exit(2);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (error) {
  console.error(`Invalid JSON: ${error.message}`);
  process.exit(2);
}

const runs = Array.isArray(parsed) ? parsed : parsed?.runs;
if (!Array.isArray(runs)) {
  console.error("Expected a JSON array or an object with a runs array");
  process.exit(2);
}

const measured = runs.flatMap((run) => {
  const usage = run?.usageJson;
  const rawInputTokens = Number(usage?.rawInputTokens ?? usage?.inputTokens ?? 0);
  if (run?.status !== "succeeded" || !Number.isFinite(rawInputTokens) || rawInputTokens <= 0) return [];

  const cachedInputTokens = Number(usage?.rawCachedInputTokens ?? usage?.cachedInputTokens ?? 0);
  const outputTokens = Number(usage?.rawOutputTokens ?? usage?.outputTokens ?? 0);
  const started = Date.parse(run.startedAt ?? "");
  const finished = Date.parse(run.finishedAt ?? "");
  const durationSeconds = Number.isFinite(started) && Number.isFinite(finished)
    ? Math.max(0, Math.round((finished - started) / 1000))
    : null;

  return [{
    rawInputTokens,
    cachedInputTokens: Number.isFinite(cachedInputTokens) ? Math.max(0, cachedInputTokens) : 0,
    uncachedInputTokens: Math.max(0, rawInputTokens - (Number.isFinite(cachedInputTokens) ? cachedInputTokens : 0)),
    outputTokens: Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0,
    durationSeconds,
    billingType: typeof usage?.billingType === "string" ? usage.billingType : "unknown",
    costStatus: typeof usage?.costStatus === "string" ? usage.costStatus : "unknown",
    finishedAt: typeof run.finishedAt === "string" ? run.finishedAt : null,
  }];
});

if (measured.length === 0) {
  console.error("No succeeded run with positive input usage was found");
  process.exit(3);
}

const sum = (key) => measured.reduce((total, run) => total + run[key], 0);
const values = (key) => measured.map((run) => run[key]).filter((value) => Number.isFinite(value));
const round = (value, digits = 2) => Number(value.toFixed(digits));
const rawInputTokens = sum("rawInputTokens");
const cachedInputTokens = sum("cachedInputTokens");
const uncachedInputTokens = sum("uncachedInputTokens");
const outputTokens = sum("outputTokens");
const durations = values("durationSeconds");
const billingCounts = new Map();

for (const run of measured) {
  const key = `${run.billingType}\u0000${run.costStatus}`;
  billingCounts.set(key, (billingCounts.get(key) ?? 0) + 1);
}

const range = (key) => {
  const items = values(key);
  return { min: Math.min(...items), max: Math.max(...items) };
};

const result = {
  schema: "optiak-run-usage-summary/v1",
  capturedThrough: measured.map((run) => run.finishedAt).filter(Boolean).sort().at(-1) ?? null,
  selection: {
    status: "succeeded",
    positiveInputUsageOnly: true,
  },
  runCount: measured.length,
  totals: {
    rawInputTokens,
    cachedInputTokens,
    uncachedInputTokens,
    outputTokens,
    durationSeconds: durations.reduce((total, value) => total + value, 0),
  },
  averages: {
    rawInputTokens: round(rawInputTokens / measured.length),
    uncachedInputTokens: round(uncachedInputTokens / measured.length),
    outputTokens: round(outputTokens / measured.length),
  },
  shares: {
    cachedInputPercent: round((cachedInputTokens / rawInputTokens) * 100),
    uncachedInputPercent: round((uncachedInputTokens / rawInputTokens) * 100),
  },
  ranges: {
    rawInputTokens: range("rawInputTokens"),
    cachedInputTokens: range("cachedInputTokens"),
    uncachedInputTokens: range("uncachedInputTokens"),
    outputTokens: range("outputTokens"),
    durationSeconds: durations.length > 0
      ? { min: Math.min(...durations), max: Math.max(...durations) }
      : { min: null, max: null },
  },
  billingModes: [...billingCounts.entries()]
    .map(([key, runCount]) => {
      const [billingType, costStatus] = key.split("\u0000");
      return { billingType, costStatus, runCount };
    })
    .sort((left, right) => `${left.billingType}:${left.costStatus}`.localeCompare(`${right.billingType}:${right.costStatus}`)),
};

console.log(JSON.stringify(result, null, 2));
