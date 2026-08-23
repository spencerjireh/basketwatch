#!/usr/bin/env node
/**
 * Guarded Bright Data CLI wrapper. Every credit-spending command goes
 * through this, so that no action can run without a cost checkpoint on
 * either side of it and a cap that can stop a runaway.
 *
 *   node lab/scripts/bd.mjs --label=vet-us -- scrape https://example.com --country us
 *   node lab/scripts/bd.mjs --report          review cost per action so far
 *   BD_DRY_RUN=1 node lab/scripts/bd.mjs -- ...   preflight only, runs nothing
 *
 * Why zones and not balance: `budget balance` rounds to the dollar and sat
 * at $52.00 across six Unlocker calls, so it cannot see a single action.
 * `budget zones` reports cost and bandwidth per zone, and bandwidth moves
 * immediately -- which is what catches the real failure mode here, an
 * unbounded crawl (one once pulled ~150 pages) long before the dollars
 * round up.
 *
 * Caps, all overridable in .env:
 *   BD_MAX_PER_ACTION_USD   0.25   one action's cost delta
 *   BD_MAX_PER_ACTION_MB    50     one action's bandwidth delta
 *   BD_MAX_PER_HOUR_USD     1.00   rolling 60 minutes, catches loops
 *   CREDIT_DAILY_CEILING_USD 5.00  calendar day
 *   BD_MIN_BALANCE_USD      20.00  reserve floor, keeps demo day funded
 *
 * A breach before the action refuses to run it (exit 2). A breach detected
 * after the action still reports and exits non-zero (exit 3), so a script
 * loop halts instead of repeating an expensive mistake.
 */
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// The one .env at the repo root, two levels up from lab/scripts/. Without this
// the caps below silently fall back to their defaults, which looks identical to
// working -- and a cap someone deliberately lowered would revert upward.
//
// Node's built-in loader rather than dotenv: this script lives outside the
// workspace, so it has no node_modules to resolve a dependency from. Same
// semantics as dotenv.config() -- a variable already set in the environment
// wins.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No .env, or a Node without loadEnvFile. The caps fall back to their
  // defaults below, which are deliberately the conservative ones.
}

const exec = promisify(execFile);

const LEDGER = process.env.BD_LEDGER
  ? new URL(`file://${process.env.BD_LEDGER}`)
  // Repo root, not lab/. The rolling per-hour and per-day caps are computed
  // from this file's history, so relocating it silently resets spend to zero.
  : new URL("../../scratch/credit-ledger.jsonl", import.meta.url);

const num = (value, fallback) => (value === undefined || value === "" ? fallback : Number(value));

const CAPS = {
  perActionUsd: num(process.env.BD_MAX_PER_ACTION_USD, 0.25),
  perActionMb: num(process.env.BD_MAX_PER_ACTION_MB, 50),
  perHourUsd: num(process.env.BD_MAX_PER_HOUR_USD, 1),
  dailyUsd: num(process.env.CREDIT_DAILY_CEILING_USD, 5),
  minBalanceUsd: num(process.env.BD_MIN_BALANCE_USD, 20),
};

const MB = 1024 * 1024;

// Killing the CLI does not stop the spend: the collection is already running
// server-side and Bright Data keeps rendering and billing it. So a timeout
// here bounds our wait, never the cost, and the caller must still meter after
// one. Learned on a $21.91 overrun; see docs/credit-monitoring.md.
const CLI_TIMEOUT_MS = num(process.env.BD_CLI_TIMEOUT_MS, 10 * 60 * 1000);

async function cli(args) {
  const cliArgs = process.env.BRIGHTDATA_API_KEY
    ? ["-k", process.env.BRIGHTDATA_API_KEY, ...args]
    : args;
  const { stdout } = await exec("bdata", cliArgs, {
    maxBuffer: 32 * 1024 * 1024,
    timeout: CLI_TIMEOUT_MS,
  });
  return stdout;
}

function parseBytes(text) {
  const match = /([\d.]+)\s*(B|KB|MB|GB|TB)/i.exec(text);
  if (!match) return 0;
  const scale = { b: 1, kb: 1024, mb: MB, gb: 1024 * MB, tb: 1024 * 1024 * MB };
  return Number(match[1]) * scale[match[2].toLowerCase()];
}

/**
 * Snapshot of every zone's cumulative cost and bandwidth, plus balance.
 * Bright Data's usage figures lag by minutes, so the per-action delta is
 * best-effort. The caps below are computed from the cumulative totals
 * instead, which self-correct once the lagging usage lands.
 */
async function meter() {
  const zones = {};
  let balanceUsd = null;
  let pendingUsd = 0;
  try {
    for (const line of (await cli(["budget", "zones"])).split(/\r?\n/)) {
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length < 3) continue;
      const [name, cost, bandwidth] = cells;
      if (!name || name === "zone" || name.startsWith("-") || name === "TOTAL") continue;
      if (!cost.startsWith("$")) continue;
      zones[name] = { usd: Number(cost.slice(1)), bytes: parseBytes(bandwidth) };
    }
  } catch {
    /* metering must never be the reason an action fails */
  }

  // Use the direct API for balance. Its `balance` field already nets out
  // pending_costs (verified against the dashboard on Aug 23: deposits minus
  // pending equals this field exactly), so subtracting pending again
  // double-counts and reported us ~$29 poorer than we were. Pending is kept
  // as an FYI only; the dashboard's Balance card remains the authority.
  const apiKey = process.env.BRIGHTDATA_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch("https://api.brightdata.com/customer/balance", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        const gross = Number(data.balance ?? NaN);
        pendingUsd = Number(data.pending_costs ?? 0);
        balanceUsd = Number.isNaN(gross) ? null : Number(gross.toFixed(2));
      }
    } catch {
      /* fall through to CLI */
    }
  }
  if (balanceUsd === null) {
    try {
      balanceUsd = Number(/Balance\s+\$([0-9.]+)/.exec(await cli(["budget", "balance"]))?.[1] ?? Number.NaN);
      if (Number.isNaN(balanceUsd)) balanceUsd = null;
    } catch {
      balanceUsd = null;
    }
  }

  const totals = Object.values(zones).reduce(
    (acc, z) => ({ usd: Number((acc.usd + z.usd).toFixed(4)), bytes: acc.bytes + z.bytes }),
    { usd: 0, bytes: 0 },
  );
  return { zones, totals, balanceUsd, pendingUsd };
}

function diff(before, after) {
  const perZone = {};
  let usd = 0;
  let bytes = 0;
  for (const name of new Set([...Object.keys(before.zones), ...Object.keys(after.zones)])) {
    const a = after.zones[name] ?? { usd: 0, bytes: 0 };
    const b = before.zones[name] ?? { usd: 0, bytes: 0 };
    const dUsd = Number((a.usd - b.usd).toFixed(4));
    const dBytes = a.bytes - b.bytes;
    if (dUsd || dBytes) perZone[name] = { usd: dUsd, bytes: dBytes };
    usd += dUsd;
    bytes += dBytes;
  }
  return { usd: Number(usd.toFixed(4)), bytes, perZone };
}

async function ledger() {
  try {
    const text = await readFile(LEDGER, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);

function since(rows, ms) {
  const cutoff = Date.now() - ms;
  return rows.filter((row) => Date.parse(row.ts) >= cutoff);
}

function today(rows) {
  const day = new Date().toISOString().slice(0, 10);
  return rows.filter((row) => row.ts.startsWith(day));
}

/**
 * Spend across a window, measured as the movement in Bright Data's own
 * cumulative total rather than the sum of our per-action deltas. Immune to
 * the reporting lag, and it also catches spend from anything that bypassed
 * this wrapper.
 */
function spentSince(rows, nowUsd) {
  if (!rows.length || nowUsd === null) return 0;
  const baseline = Math.min(...rows.map((row) => row.cumBeforeUsd ?? Number.POSITIVE_INFINITY));
  if (!Number.isFinite(baseline)) return 0;
  return Number(Math.max(0, nowUsd - baseline).toFixed(4));
}

async function record(entry) {
  await mkdir(new URL(".", LEDGER), { recursive: true });
  await appendFile(LEDGER, `${JSON.stringify(entry)}\n`);
}

const usd = (n) => `$${n.toFixed(2)}`;
const mb = (bytes) => `${(bytes / MB).toFixed(1)} MB`;

async function preflight(label, args) {
  const rows = await ledger();
  const before = await meter();

  // Zone-based spend (Unlocker, SERP, Browser proxies).
  const spentTodayZones = spentSince(today(rows), before.totals.usd);
  const spentHourZones = spentSince(since(rows, 60 * 60 * 1000), before.totals.usd);

  // Balance-based spend (catches everything including Studio CPM).
  // Uses the recorded balanceBefore from the earliest ledger entry in the
  // window vs the current balance.
  const balanceSpentInWindow = (windowRows) => {
    if (!windowRows.length || before.balanceUsd === null) return 0;
    const earliest = windowRows.reduce((best, r) =>
      (r.balanceBefore ?? r.balanceAfter ?? Infinity) > (best.balanceBefore ?? best.balanceAfter ?? Infinity) ? r : best,
      windowRows[0],
    );
    const startBalance = earliest.balanceBefore ?? earliest.balanceAfter ?? null;
    if (startBalance === null) return 0;
    return Number(Math.max(0, startBalance - before.balanceUsd).toFixed(2));
  };
  const spentTodayBalance = balanceSpentInWindow(today(rows));
  const spentHourBalance = balanceSpentInWindow(since(rows, 60 * 60 * 1000));

  const spentToday = Math.max(spentTodayZones, spentTodayBalance);
  const spentHour = Math.max(spentHourZones, spentHourBalance);

  console.log(`action    ${label}`);
  console.log(`command   bdata ${args.join(" ")}`);
  console.log(
    `spent     ${usd(spentToday)} today of ${usd(CAPS.dailyUsd)}, ${usd(spentHour)} in the last hour of ${usd(CAPS.perHourUsd)}`,
  );
  if (spentTodayBalance > spentTodayZones) {
    console.log(`          (${usd(spentTodayBalance)} from balance drop, ${usd(spentTodayZones)} from zones)`);
  }
  console.log(`balance   ${before.balanceUsd === null ? "unavailable" : usd(before.balanceUsd)}${before.pendingUsd ? ` (${usd(before.pendingUsd)} pending)` : ""}`);

  const breaches = [];
  if (spentToday >= CAPS.dailyUsd) breaches.push(`daily ceiling reached (${usd(spentToday)} of ${usd(CAPS.dailyUsd)})`);
  if (spentHour >= CAPS.perHourUsd) breaches.push(`hourly cap reached (${usd(spentHour)} of ${usd(CAPS.perHourUsd)})`);
  if (before.balanceUsd !== null && before.balanceUsd < CAPS.minBalanceUsd)
    breaches.push(`balance ${usd(before.balanceUsd)} is below the ${usd(CAPS.minBalanceUsd)} reserve floor`);
  return { before, breaches };
}

async function run(label, args) {
  const { before, breaches } = await preflight(label, args);

  if (breaches.length) {
    console.error(`\nREFUSED. ${breaches.join("; ")}.`);
    console.error("Raise the cap deliberately in .env if this spend is intended.");
    process.exit(2);
  }
  if (process.env.BD_DRY_RUN) {
    console.log("\ndry run, nothing executed");
    return;
  }

  const startedAt = Date.now();
  let ok = true;
  let output = "";
  try {
    output = await cli(args);
    process.stdout.write(output);
  } catch (err) {
    ok = false;
    process.stderr.write(String(err.stdout || "") + String(err.stderr || err.message || err));
  }

  // Usage lands late. Wait when the action is expensive enough that its
  // true cost matters immediately -- a Studio create or heal, say.
  const settleMs = num(process.env.BD_SETTLE_MS, 0);
  if (settleMs > 0) {
    console.log(`\nwaiting ${settleMs / 1000}s for usage to settle`);
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }

  const after = await meter();
  const delta = diff(before, after);

  // Balance-based cost: catches Scraper Studio CPM spend that never
  // appears in zone totals. `budget balance` rounds to the dollar, so
  // small actions read as $0 -- but a runaway crawl ($12+ in one shot)
  // will show up here even when zones report nothing.
  const balanceDrop =
    before.balanceUsd !== null && after.balanceUsd !== null
      ? Number(Math.max(0, before.balanceUsd - after.balanceUsd).toFixed(2))
      : 0;
  const effectiveCost = Math.max(delta.usd, balanceDrop);

  const entry = {
    ts: new Date().toISOString(),
    label,
    command: args.join(" "),
    ok,
    seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    usd: delta.usd,
    balanceDrop,
    effectiveCost,
    bytes: delta.bytes,
    zones: delta.perZone,
    cumBeforeUsd: before.totals.usd,
    cumAfterUsd: after.totals.usd,
    cumAfterBytes: after.totals.bytes,
    balanceBefore: before.balanceUsd,
    balanceAfter: after.balanceUsd,
  };
  await record(entry);

  const attributed = Object.keys(delta.perZone).length
    ? ` (${Object.entries(delta.perZone)
        .map(([zone, d]) => `${zone} ${usd(d.usd)}/${mb(d.bytes)}`)
        .join(", ")})`
    : "";
  const balanceNote = balanceDrop > 0 ? ` (balance dropped ${usd(balanceDrop)})` : "";
  console.log(`\ncost      ${usd(effectiveCost)} on this action${attributed}${balanceNote}`);
  if (delta.bytes > 0) console.log(`bandwidth ${mb(delta.bytes)}`);
  console.log(`balance   ${after.balanceUsd === null ? "unavailable" : usd(after.balanceUsd)}`);
  console.log(`cumulative ${usd(after.totals.usd)} and ${mb(after.totals.bytes)} across all zones`);

  const overCost = effectiveCost > CAPS.perActionUsd;
  const overBandwidth = delta.bytes > CAPS.perActionMb * MB;
  if (overCost || overBandwidth) {
    console.error(
      `\nHALT. This action ${overCost ? `cost ${usd(effectiveCost)}, over the ${usd(CAPS.perActionUsd)} per-action cap` : ""}${
        overCost && overBandwidth ? " and " : ""
      }${overBandwidth ? `pulled ${mb(delta.bytes)}, over the ${CAPS.perActionMb} MB per-action cap` : ""}.`,
    );
    console.error("Check the scraper's crawl scope before running anything else.");
    process.exit(3);
  }
  if (!ok) process.exit(1);
}

async function report() {
  const rows = await ledger();
  if (!rows.length) {
    console.log("no actions recorded yet");
    return;
  }

  const byLabel = new Map();
  for (const row of rows) {
    const current = byLabel.get(row.label) ?? { count: 0, usd: 0, effectiveCost: 0, bytes: 0, failures: 0 };
    current.count += 1;
    current.usd += row.usd ?? 0;
    current.effectiveCost += row.effectiveCost ?? row.usd ?? 0;
    current.bytes += row.bytes ?? 0;
    if (!row.ok) current.failures += 1;
    byLabel.set(row.label, current);
  }

  console.log("action                 calls  zones  bal-drop  bandwidth  failed");
  console.log("----------------------------------------------------------------");
  for (const [label, s] of [...byLabel.entries()].sort((a, b) => b[1].effectiveCost - a[1].effectiveCost)) {
    console.log(
      `${label.slice(0, 22).padEnd(22)} ${String(s.count).padStart(5)}  ${usd(s.usd).padStart(5)}  ${usd(s.effectiveCost).padStart(8)}  ${mb(s.bytes).padStart(9)}  ${String(s.failures).padStart(6)}`,
    );
  }

  const zoneTotal = sum(rows, "usd");
  const effectiveTotal = rows.reduce((t, r) => t + (r.effectiveCost ?? r.usd ?? 0), 0);
  console.log("----------------------------------------------------------------");
  console.log(
    `${"total".padEnd(22)} ${String(rows.length).padStart(5)}  ${usd(zoneTotal).padStart(5)}  ${usd(effectiveTotal).padStart(8)}  ${mb(sum(rows, "bytes")).padStart(9)}`,
  );

  const now = await meter();
  console.log(`\nzones      ${usd(now.totals.usd)} and ${mb(now.totals.bytes)} reported by Bright Data`);
  if (now.balanceUsd != null) {
    console.log(`balance    ${usd(now.balanceUsd)} available${now.pendingUsd ? ` (${usd(now.pendingUsd)} pending)` : ""}, reserve floor ${usd(CAPS.minBalanceUsd)}`);
    const firstWithBalance = rows.find((r) => r.balanceBefore != null || r.balanceAfter != null);
    if (firstWithBalance) {
      const startBal = firstWithBalance.balanceBefore ?? firstWithBalance.balanceAfter;
      const totalBalDrop = Number(Math.max(0, startBal - now.balanceUsd).toFixed(2));
      if (totalBalDrop > 0) {
        console.log(`all-time   ${usd(totalBalDrop)} balance consumed since first tracked action`);
      }
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--report")) return report();

  const label = argv.find((a) => a.startsWith("--label="))?.split("=")[1] ?? "unlabelled";
  const separator = argv.indexOf("--");
  const args = separator === -1 ? argv.filter((a) => !a.startsWith("--label=")) : argv.slice(separator + 1);
  if (!args.length) {
    console.error("usage: node lab/scripts/bd.mjs [--label=name] -- <brightdata args>");
    console.error("       node lab/scripts/bd.mjs --report");
    process.exit(64);
  }
  return run(label, args);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
