import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {madridPeriodParams} from "../src/time.mjs";

test("Madrid periods honor winter, summer and DST transition lengths", () => {
  assert.deepEqual(madridPeriodParams("2026-01-15", "2026-01-15"), {
    after: "2026-01-14T23:00:00.000Z",
    before: "2026-01-15T22:59:59.999Z",
  });
  assert.deepEqual(madridPeriodParams("2026-07-15", "2026-07-15"), {
    after: "2026-07-14T22:00:00.000Z",
    before: "2026-07-15T21:59:59.999Z",
  });
  assert.deepEqual(madridPeriodParams("2026-03-29", "2026-03-29"), {
    after: "2026-03-28T23:00:00.000Z",
    before: "2026-03-29T21:59:59.999Z",
  });
  assert.deepEqual(madridPeriodParams("2026-10-25", "2026-10-25"), {
    after: "2026-10-24T22:00:00.000Z",
    before: "2026-10-25T22:59:59.999Z",
  });
});

test("Madrid periods do not depend on the host TZ", () => {
  const moduleUrl = new URL("../src/time.mjs", import.meta.url).href;
  const script = `import {madridPeriodParams} from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(madridPeriodParams("2026-03-29", "2026-10-25")));`;
  const outputs = ["UTC", "America/Los_Angeles", "Asia/Tokyo"].map((timezone) => {
    const run = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {encoding: "utf8", env: {...process.env, TZ: timezone}});
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  });
  assert.equal(new Set(outputs).size, 1);
});

test("periods reject impossible dates and reversed ranges", () => {
  assert.throws(() => madridPeriodParams("2026-02-30", "2026-03-01"), /real calendar date/);
  assert.throws(() => madridPeriodParams("2026-03-02", "2026-03-01"), /must not be after/);
});
