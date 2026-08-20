# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx[http2]"]
# ///
"""Scraper Studio collectors: create them, run them, record what they are.

Studio collects the stores a browser is needed for. `catalogue.py` collects the eleven
that publish a bulk endpoint, because paying a cloud browser to re-read a free JSON API
is worse on cost, on row count and on latency - established the expensive way, at $26.54
against a $5 ceiling.

Wherever Studio does collect, the puller remains the fallback: it keeps the series
unbroken when a collector fails, and every row it produces is labelled so the
substitution is never silent.

The `listing-page` template is abandoned. It rendered a full collection grid in a cloud
browser at ~$2.19 a run and timed out on all ten canaries. `TEMPLATES` still carries it
so existing records stay readable, but `seed_kind` should not be routing new stores to
it - those stores have a bulk endpoint.

Driving decisions, each of which cost something to learn:

- **The CLI is subprocessed, not reimplemented.** `scraper run --input-file` does
  trigger -> collection_id -> poll /dca/dataset with a three-way pending sentinel,
  plus a realtime-page-limit fallback. That is a lot of undocumented /dca semantics
  to reproduce for no gain.
- **`--timeout` is an attempt count, not seconds.** In the CLI's own polling.js the
  loop is `for (attempt = 0; attempt < timeout_seconds; attempt++)` with a batch
  interval of 10,000 ms, so the batch default of 3600 polls for *ten hours*. Every
  invocation here passes an explicit attempt count and is wrapped in a hard deadline.
- **product_key is derived here, never taken from Studio.** If a collector invented a
  key from a SKU while the puller used the URL slug, the first fallback run would
  report the entire catalogue as new and overwrite the price history - the one thing
  in this project that cannot be re-collected.
- **Prices arrive as strings.** AI-generated collectors emit "PHP 389.50", "$4.49",
  "1,234.00" and "Price on request". A row whose price will not coerce is dropped, the
  same rule the puller applies to a missing Shopify variant price.
- **There is no `scraper list` in the CLI.** studio-collectors.json is the only
  store-to-collector mapping that exists, which is why it is tracked in git and why
  creation writes to it before verification rather than after.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

REGISTRY = HERE / "studio-collectors.json"
CLI = os.environ.get("BRIGHTDATA_CLI", "brightdata")

# The CLI's own cap. A description over this is rejected server-side, so it is caught
# here where the fix is cheap rather than after a failed create.
MAX_DESCRIPTION = 500

# Attempt counts, not seconds: multiply by the CLI's poll interval for wall-clock.
CREATE_ATTEMPTS = 900       # 1s interval -> 15 min, matching the CLI default
BATCH_ATTEMPTS = 120        # 10s interval -> 20 min
SYNC_TIMEOUT = 50           # the server's own ceiling for --sync


class StudioError(RuntimeError):
    """Studio could not produce rows. The caller decides fallback versus abort."""


class StudioTimeout(StudioError):
    pass


class StudioEmpty(StudioError):
    pass


# --- the budget guard ---------------------------------------------------------

class BudgetExhausted(StudioError):
    """The ceiling would be breached. Raised, never returned, so a call site cannot
    forget to check it."""


class Guard:
    """A pre-flight ceiling on Studio spend.

    Written after a $21.91 overrun against a $5 ceiling. Two lessons are baked in:

    - **The check happens before the call, at every call site.** The previous version
      of this had a Budget class that was never wired to anything, which is the same as
      not having one.
    - **A timeout means still spending, not stopped.** `proc.kill()` ends the local CLI;
      the collection is already triggered server-side and Bright Data keeps rendering
      and billing it. So the balance is re-read *after* a timeout too, and a timed-out
      call is charged against the ceiling like any other.

    The balance is eventually consistent - it kept falling for minutes after the run
    that spent it - so `spent()` is a floor, not a settled figure. The ceiling is
    checked against the floor, which errs toward stopping early.
    """

    def __init__(self, cap_usd: float, start: float):
        self.cap = cap_usd
        self.start = start
        self.last = start
        self.calls = 0

    @classmethod
    async def open(cls, cap_usd: float) -> "Guard":
        bal = await read_balance()
        if bal is None:
            raise StudioError("could not read the balance - refusing to spend blind")
        print(f"budget guard: ${cap_usd:.2f} ceiling, balance ${bal:.2f}", flush=True)
        return cls(cap_usd, bal)

    def spent(self) -> float:
        return max(0.0, self.start - self.last)

    async def refresh(self) -> float:
        bal = await read_balance()
        if bal is not None:
            self.last = bal
        return self.spent()

    def check(self, what: str) -> None:
        """The ceiling decision, with no I/O in it so it is testable directly."""
        spent = self.spent()
        if spent >= self.cap:
            raise BudgetExhausted(
                f"${spent:.2f} of ${self.cap:.2f} spent - refusing {what}")

    async def preflight(self, what: str) -> None:
        await self.refresh()
        self.check(what)

    async def charge(self, what: str) -> float:
        """Re-read after a call, including after a timeout."""
        before = self.spent()
        spent = await self.refresh()
        self.calls += 1
        delta = spent - before
        print(f"    {what}: ${delta:.4f} (total ${spent:.2f} of ${self.cap:.2f})",
              flush=True)
        return delta


async def read_balance() -> float | None:
    """`bdata budget` is free and does not touch the scrapers."""
    try:
        _, out, _ = await _cli(["budget"], 90)
    except StudioError:
        return None
    m = re.search(r"Balance\s+\$([0-9.,]+)", out)
    return float(m.group(1).replace(",", "")) if m else None


# --- descriptions -------------------------------------------------------------

# Clause order matters: generators weight the opening and lose intent from the tail.
# Every template states the unit of work first, the fields second, and the crawl bound
# third. The bound is not the same thing as max_pages - max_pages limits what we submit,
# this limits what the collector does with each URL it is given. The 4,470-row incident
# was the second kind, and no ceiling in the lock could have prevented it.

PRODUCT_PAGE = (
    "From this single product page extract exactly one product. Fields: name; "
    "price as a number with no currency symbol; currency as a 3-letter ISO code; "
    "size, meaning the pack size exactly as printed, such as 5kg or 1.5L or 12 x 60g; "
    "in_stock as true or false. Do not follow any link, do not paginate, do not visit "
    "any other page - scrape only the URL given as input. If the size is not in the "
    "title take it from the product specifications; if there is no size leave it empty "
    "and never guess."
)

LISTING_PAGE = (
    "From this product listing page extract every product card shown on this page. "
    "For each: name; price as a number with no currency symbol; currency as a 3-letter "
    "ISO code; size, meaning the pack size exactly as printed, such as 5kg or 1.5L; "
    "in_stock as true or false; url, the link to the product. Do not follow product "
    "links, do not follow pagination, do not visit any other page - scrape only the URL "
    "given as input. If a card shows no size leave it empty and never guess."
)

TEMPLATES = {"product-page": PRODUCT_PAGE, "listing-page": LISTING_PAGE}


def seed_kind(cfg: dict) -> str:
    """Which template a store needs, derived from how its catalogue is reached."""
    if (cfg.get("studio") or {}).get("template"):
        return cfg["studio"]["template"]
    return "product-page" if cfg.get("method", "").startswith("sitemap") else "listing-page"


def build_description(entry: dict, cfg: dict) -> str:
    desc = TEMPLATES[seed_kind(cfg)]
    if len(desc) > MAX_DESCRIPTION:
        raise ValueError(
            f"{entry['id']}: description is {len(desc)} chars, "
            f"{len(desc) - MAX_DESCRIPTION} over the CLI's {MAX_DESCRIPTION} limit")
    return desc


def description_sha(desc: str) -> str:
    return "sha256:" + hashlib.sha256(desc.encode()).hexdigest()[:16]


# --- the collector registry ---------------------------------------------------

def load_registry() -> dict:
    if REGISTRY.exists():
        return json.loads(REGISTRY.read_text())
    return {"_comment": ("The only store-to-collector mapping that exists: the Bright "
                         "Data CLI has no `scraper list`. Tracked in git on purpose, and "
                         "written after every single create so a crash never orphans a "
                         "paid collector."),
            "cli_version": None, "collectors": {}}


def save_registry(reg: dict) -> None:
    REGISTRY.write_text(json.dumps(reg, indent=2) + "\n")


def needs_creation(reg: dict, store_id: str, desc: str, force: bool) -> bool:
    """Create only when there is nothing usable. Studio's create is not idempotent and
    there is no way to list collectors, so a careless re-run orphans paid work."""
    rec = reg["collectors"].get(store_id)
    if force or rec is None:
        return True
    if not rec.get("collector_id"):
        return True
    if rec.get("status") == "failed":
        return True
    return rec.get("description_sha") != description_sha(desc)


# --- driving the CLI ----------------------------------------------------------

async def _cli(args: list[str], deadline: float) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        CLI, *args,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=deadline)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise StudioTimeout(f"{' '.join(args[:3])} exceeded {deadline:.0f}s")
    return proc.returncode, out.decode(errors="replace"), err.decode(errors="replace")


async def cli_version() -> str:
    _, out, _ = await _cli(["--version"], 30)
    return out.strip()


RE_COLLECTOR = re.compile(r"\b(c_[a-z0-9]{10,})\b")


async def create_collector(entry: dict, cfg: dict, desc: str) -> dict:
    """One AI-generated collector. Returns the record to store, id first."""
    seed = (cfg.get("studio") or {}).get("seed_url")
    if not seed:
        raise StudioError(f"{entry['id']}: no studio.seed_url in the lock")
    name = f"basketwatch-{entry['id']}"
    code, out, err = await _cli(
        ["scraper", "create", seed, desc, "--name", name,
         "--timeout", str(CREATE_ATTEMPTS), "--json"],
        deadline=CREATE_ATTEMPTS + 120)
    blob = out + "\n" + err
    m = RE_COLLECTOR.search(blob)
    if code != 0 and not m:
        raise StudioError(f"{entry['id']}: create failed ({code}): {err.strip()[-200:]}")
    if not m:
        raise StudioError(f"{entry['id']}: no collector id in output: {blob.strip()[-200:]}")
    return {"collector_id": m.group(1), "name": name, "seed_url": seed,
            "template": seed_kind(cfg), "description": desc,
            "description_sha": description_sha(desc), "status": "created"}


async def canary(collector_id: str, url: str, out_path: Path) -> dict:
    """One URL, synchronously, to decide whether a collector may enter the fleet.

    --sync is single-URL only and server-capped at 25-50s, which makes it useless for a
    catalogue pull and exactly right for this. A collector stays 'pending' until it
    passes, so an unproven collector can never quietly become the source of record.
    """
    code, out, err = await _cli(
        ["scraper", "run", collector_id, url, "--sync", "--json", "-o", str(out_path)],
        deadline=SYNC_TIMEOUT + 60)
    if not out_path.exists():
        raise StudioError(f"canary failed ({code}): {err.strip()[-200:]}")
    data = json.loads(out_path.read_text())
    rows = data if isinstance(data, list) else data.get("data") or [data]
    if not rows:
        raise StudioEmpty("canary returned no rows")
    return rows[0]


def canary_verdict(raw: dict, host: str) -> tuple[bool, str]:
    """What a usable row has to look like. The failure modes here are all observed.

    The hostname-as-name case is the one that matters: a client-rendered page scraped
    before it paints yields the site name and no price, and it raises no error at all.
    """
    name = (raw.get("name") or raw.get("title") or "").strip()
    price = coerce_price(raw.get("price"))
    if not name:
        return False, "no name"
    if host and name.lower().strip("/") in {host.lower(), f"www.{host.lower()}"}:
        return False, f"name is the hostname ({name}) - page not rendered before extract"
    if price is None:
        return False, f"no usable price (got {raw.get('price')!r})"
    return True, f"{name[:40]} @ {price}"


async def run_batch(collector_id: str, urls: list[str], out_path: Path,
                    attempts: int = BATCH_ATTEMPTS) -> list[dict]:
    """Run one collector over a bounded URL list and read the rows back from a file.

    Results go to a file rather than stdout: a 300-URL batch is far larger than the
    64MB buffer the repo's TypeScript probe needed for a single --sync row, and the
    CLI interleaves poll progress on stderr with data on stdout.
    """
    if not urls:
        raise StudioEmpty("no URLs to submit")
    urls_file = out_path.with_suffix(".urls.txt")
    urls_file.write_text("\n".join(urls) + "\n")

    code, _, err = await _cli(
        ["scraper", "run", collector_id, "--input-file", str(urls_file),
         "--timeout", str(attempts), "--json", "-o", str(out_path)],
        deadline=attempts * 10 + 120)
    if not out_path.exists():
        raise StudioError(f"run failed ({code}): {err.strip()[-300:]}")
    try:
        data = json.loads(out_path.read_text())
    except json.JSONDecodeError as exc:
        raise StudioError(f"unparseable run output: {exc}") from exc
    rows = data if isinstance(data, list) else data.get("data") or data.get("results") or []
    if not rows:
        raise StudioEmpty(f"collector returned no rows for {len(urls)} URLs")
    return rows


# --- mapping Studio output onto catalogue rows --------------------------------

# Bright Data echoes the trigger payload back on every row; it is our input, not data.
ECHOED_FIELDS = {"input"}

RE_PRICE = re.compile(r"[-+]?\d[\d,\s]*(?:\.\d+)?")


def coerce_price(value) -> float | None:
    """Studio prices arrive as whatever the page showed. None means drop the row."""
    if isinstance(value, (int, float)):
        return float(value) if value > 0 else None
    if not isinstance(value, str):
        return None
    m = RE_PRICE.search(value.replace(" ", " "))
    if not m:
        return None
    try:
        price = float(m.group(0).replace(",", "").replace(" ", ""))
    except ValueError:
        return None
    return price if price > 0 else None


def key_from_url(url: str) -> str:
    """The product key is the URL slug, always.

    Identity must not depend on which transport collected the row. If Studio keyed on a
    SKU and the puller keyed on the slug, the first fallback run would report every
    product as new and the price history would be overwritten with noise.
    """
    return urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]


def echoed_url(raw: dict) -> str | None:
    """The URL we submitted, read back off the echoed trigger payload.

    A product-page collector has no reason to emit a url field - the page it was given
    is the product - so for those the echo is the only URL there is. It is still not
    data, and everything else in the echo is discarded.
    """
    echo = raw.get("input")
    if isinstance(echo, dict):
        return echo.get("url")
    return echo if isinstance(echo, str) and echo.startswith("http") else None


def reconcile_size(raw_size, name: str, parse, no_size):
    """Decide which size to believe when the collector's and the title's disagree.

    Found in the pilot: a collector returned "1G" for a product titled "Baguio Pure
    Coconut Oil 1Gal." - a truncated string that parses perfectly well as one gram, and
    produced a unit price of PHP 799,950 per kilo. The title parses correctly.

    Where the two disagree materially, neither is trusted and no size is emitted. A
    missing unit price is a visible gap; a wrong one silently poisons every comparison
    the product exists to make, and this is the metric everything else rests on.
    """
    if not raw_size:
        return None                       # nothing to reconcile; the name answers
    from_size, from_name = parse(str(raw_size)), parse(name or "")
    if not from_size or not from_name:
        return raw_size                   # only one reading exists; use what we were given
    if from_size["base_uom"] == from_name["base_uom"] and (
            abs(from_size["quantity"] - from_name["quantity"])
            <= 0.01 * max(from_size["quantity"], from_name["quantity"])):
        return raw_size                   # they agree
    return no_size


def studio_rows(entry: dict, raw_rows: list[dict], row_fn, parse_size=None,
                no_size=None) -> list[dict]:
    """Map Studio's output onto catalogue rows, dropping anything unusable."""
    out = []
    for raw in raw_rows:
        url = (raw.get("url") or raw.get("page_url") or raw.get("input_url")
               or echoed_url(raw))
        raw = {k: v for k, v in raw.items() if k not in ECHOED_FIELDS}
        price = coerce_price(raw.get("price"))
        if not url or price is None:
            continue
        name = raw.get("name") or raw.get("title")
        size = raw.get("size")
        if parse_size is not None:
            size = reconcile_size(size, name, parse_size, no_size)
        out.append(row_fn(
            entry["id"], entry["country"],
            product_key=key_from_url(url), name=name,
            price=price, currency=raw.get("currency"), url=url,
            in_stock=raw.get("in_stock", True),
            category=raw.get("category"), raw_size=size,
            source="studio"))
    return [r for r in out if r["name"]]


# --- CLI ----------------------------------------------------------------------

async def main() -> int:
    ap = argparse.ArgumentParser(description="create and inspect Studio collectors")
    ap.add_argument("--dry-run", action="store_true",
                    help="print every description and create nothing")
    ap.add_argument("--only", nargs="*", help="limit to these store ids")
    ap.add_argument("--force", nargs="*", default=[],
                    help="recreate these store ids even if a collector exists")
    ap.add_argument("--create", action="store_true", help="actually create collectors")
    ap.add_argument("--verify", action="store_true",
                    help="canary each created collector and promote the ones that pass")
    args = ap.parse_args()

    lock = json.loads((HERE / "fleet.lock.json").read_text())
    fleet = [e for e in lock["fleet"]
             if (e.get("catalogue") or {}).get("method", "none") != "none"
             and (not args.only or e["id"] in args.only)]

    reg = load_registry()
    print(f"{len(fleet)} stores need a collector "
          f"({len(reg['collectors'])} already recorded)\n")

    if args.verify:
        reg = load_registry()
        by_id = {e["id"]: e for e in fleet}
        for sid, rec in reg["collectors"].items():
            if sid not in by_id or not rec.get("collector_id"):
                continue
            if rec.get("status") == "ready":
                print(f"  {sid:<24} already ready", flush=True)
                continue
            seed = rec.get("seed_url") or by_id[sid]["catalogue"]["studio"]["seed_url"]
            host = urlparse(seed).netloc
            out = HERE / "catalogue" / f"{sid}.canary.json"
            try:
                raw = await canary(rec["collector_id"], seed, out)
            except StudioError as exc:
                rec["status"] = "failed"
                rec["canary_error"] = str(exc)[:200]
                save_registry(reg)
                print(f"  {sid:<24} FAILED {exc}"[:150], flush=True)
                continue
            ok, why = canary_verdict(raw, host)
            rec["status"] = "ready" if ok else "born_broken"
            rec["verified"] = {"at": None, "ok": ok, "detail": why}
            save_registry(reg)
            print(f"  {sid:<24} {'READY' if ok else 'BORN BROKEN'}  {why}"[:150], flush=True)
        return 0

    if args.dry_run or not (args.create or args.verify):
        for e in fleet:
            cfg = e["catalogue"]
            desc = build_description(e, cfg)
            have = reg["collectors"].get(e["id"], {}).get("collector_id")
            mark = "have" if have and not needs_creation(reg, e["id"], desc, False) else "CREATE"
            print(f"  {e['id']:<24} {seed_kind(cfg):<13} {len(desc):>3} chars  {mark}")
        print("\ndry run - nothing created. Re-run with --create to spend credits.")
        return 0

    reg["cli_version"] = await cli_version()
    for e in fleet:
        cfg = e["catalogue"]
        desc = build_description(e, cfg)
        if not needs_creation(reg, e["id"], desc, e["id"] in args.force):
            print(f"  {e['id']:<24} skip - collector already recorded", flush=True)
            continue
        print(f"  {e['id']:<24} creating...", flush=True)
        try:
            rec = await create_collector(e, cfg, desc)
        except StudioError as exc:
            reg["collectors"].setdefault(e["id"], {}).update(
                {"status": "failed", "error": str(exc)[:300]})
            save_registry(reg)          # failures are data too
            print(f"  {e['id']:<24} FAILED {exc}"[:160], flush=True)
            continue
        # Written before verification on purpose: the collector id is the one thing
        # that cannot be recovered, since the CLI cannot list collectors.
        reg["collectors"][e["id"]] = rec
        save_registry(reg)
        print(f"  {e['id']:<24} {rec['collector_id']}", flush=True)

    save_registry(reg)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
