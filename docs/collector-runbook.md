# Collector Runbook

Step-by-step procedure for creating Studio collectors on any Bright Data
account. Every pullable store in the fleet needs a collector before the
production pipeline can run.

Source of truth for collector definitions: `docs/collector-manifest.json`.

## Prerequisites

- Bright Data account with CLI access (`brightdata` v0.3.4+)
- CLI authenticated: `brightdata login` (or `bdata login`)
- Credit guard available: `node lab/scripts/bd.mjs`
- Access to the target database (local or production)

## Steps

Each step has a defined input, action, output, and gate. Do not proceed
to the next step until the gate passes.

### Step 1: Probe (already completed for all 16 stores)

**Input:** Store URL, HTTP method (shopify / magento-graphql / sitemap).

**Action:** Run the HTTP adapter against the store. Inspect the raw
response for field names, price format, currency, page structure,
rendering behavior.

**Output:** Structural findings documented in the manifest's
`probeFindings` field.

**Gate:** `probeFindings` written and reviewed by a team member.

**Status:** Done. All 16 stores have probe findings recorded in
`docs/collector-manifest.json`.

### Step 2: Craft description

**Input:** `probeFindings` for the store from the manifest.

**Action:** Distill findings into a concise `description` (1-3
sentences). The description must:

1. Name the page type (listing page vs. product page)
2. Name the currency code (PHP or USD)
3. Name all six output fields: name, price, currency, url, size,
   in\_stock
4. Include the crawl bound: "this page only; do not follow links"
5. Note any store-specific structure (e.g. "no structured data" for
   bare-HTML stores, "client-rendered" for SPAs)

The description is NOT a dump of probe findings. It is a concise
instruction to Studio's AI.

**Output:** `description` field in the manifest.

**Gate:** Description is within the character limit, names all six output
fields, includes the crawl bound clause.

**Status:** Done. All 16 descriptions are in the manifest.

### Step 3: Create collector

**Input:** `seedUrl`, `description`, `name` from the manifest entry.

**Action:**

```sh
node lab/scripts/bd.mjs --label=create-<storeId> -- \
  scraper create "<seedUrl>" "<description>" \
  --name "<name>" --timeout 900
```

Creation goes through the credit guard. Generation itself is free but
takes 1-25 minutes. The `--timeout 900` gives Studio up to 15 minutes
to generate the scraper code.

**Output:** `collector_id` returned by the CLI (starts with `c_`).

**Gate:** CLI exits 0 and returns a valid collector ID.

**If generation fails:** Check the Bright Data web UI for the collector.
The CLI timeout kills the local process but does not stop the remote
generation job. Wait for it to finish in the UI, or retry with a
revised description.

### Step 4: Record collector ID

**Input:** `collector_id` from Step 3.

**Action:**

```sql
UPDATE stores
SET studio_collector_id = '<collector_id>'
WHERE store_id = '<storeId>';
```

Also insert a row into the `scrapers` table if one does not exist:

```sql
INSERT INTO scrapers (id, name, target_site, status)
VALUES ('<collector_id>', '<name>', '<seedUrl>', 'healthy')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, target_site = EXCLUDED.target_site;
```

Record the mapping in the manifest's `prodCollectorId` field for
traceability (which account, which collector ID).

**Output:** `stores.studio_collector_id` populated.

**Gate:**

```sql
SELECT store_id, studio_collector_id FROM stores WHERE store_id = '<storeId>';
-- Must return the expected collector ID
```

### Step 5: Canary run

**Input:** `collector_id`, `seedUrl` from the manifest.

**Action:**

```sh
node lab/scripts/bd.mjs --label=canary-<storeId> -- \
  scraper run <collector_id> "<seedUrl>" --json
```

This runs a single-URL canary through the credit guard.

**Output:** JSON array of scraped rows.

**Gate:** All of the following must be true:

- [ ] At least 1 row returned
- [ ] Every row contains the required fields: `name`, `price`, `url`
- [ ] `price` parses as a positive number
- [ ] `url` is a valid URL on the store's domain
- [ ] `name` is not the page hostname, a URL, or a placeholder
- [ ] `currency` matches the expected code (PHP or USD) if present

### Step 6: Approve and mark ready

**Input:** Canary output from Step 5.

**Action:** If the canary gate passes:

```sh
brightdata scraper approve <collector_id>
```

Update the manifest entry:
- Set `prodStatus` to `"healthy"`
- Clear any `prodGap` notes

**Output:** Collector is approved and live.

**Gate:** Manifest shows updated `prodStatus` for this store.

### Step 7: Heal and retry (if canary fails)

**Input:** Failed canary output with specific failure details.

**Action:** Heal the collector with a targeted prompt describing what
went wrong. Do NOT use `--auto-approve` -- always review the diff
before approving.

```sh
node lab/scripts/bd.mjs --label=heal-<storeId> -- \
  scraper heal <collector_id> "<what went wrong and what to fix>"
```

The heal pauses after generating the fix. Review the changes at the
`view_url` printed in the output, then approve or reject:

```sh
brightdata scraper approve <collector_id>      # accept the fix
brightdata scraper approve <collector_id> --reject  # reject and retry
```

Example prompts:

- "The name field is returning the page URL instead of the product
  name. Extract the product title from the heading element."
- "Price is missing. The price is displayed in PHP format like
  'PHP 389.50' near the product name."
- "The scraper is navigating to other pages. Only extract data from
  the input URL, do not click or follow any links."

**Output:** Updated collector code (after human review and approval).

**Gate:** Re-run Step 5. If it fails again after 2 heal attempts, flag
for manual review in the Bright Data web UI.

## Rollout order

### Phase 1: Test subset (3 stores)

Pick one store from each structural class to validate the descriptions:

1. **Shopify listing-page:** ph-shopgaisano or us-sukli
2. **Product-page (json-ld):** us-dierbergs
3. **Product-page (bare-html or SPA):** us-kesargrocery or ph-landers

Create collectors on the test account. Run Steps 3-6 for each. This
validates the description templates before committing credits on the
full fleet.

### Phase 2: Remaining stores

Once the subset validates, create the remaining 13 collectors on the
same test account. Run Steps 3-6 for each.

### Phase 3: Production account

Repeat Steps 3-6 for all 16 stores on the production Bright Data
account. The manifest, descriptions, and seed URLs are identical; only
the `collector_id`s differ.

## Checking current state

Before starting the rollout, query the deployed Postgres to understand
what data exists and where the gaps are:

```sql
-- Price freshness per store
SELECT s.store_id, s.method,
       count(DISTINCT p.product_key) as products,
       max(po.observed_at)::date as last_price_update,
       CURRENT_DATE - max(po.observed_at)::date as days_stale
FROM stores s
LEFT JOIN products p ON p.store_id = s.store_id
LEFT JOIN price_observations po ON po.store_id = s.store_id
WHERE s.method IS NOT NULL AND s.method <> 'none'
GROUP BY s.store_id, s.method
ORDER BY days_stale DESC NULLS FIRST;

-- Run history by transport
SELECT store_id, transport, count(*) as runs,
       max(rows) as best_rows, max(at)::date as last_run
FROM runs
WHERE store_id IS NOT NULL
GROUP BY store_id, transport
ORDER BY store_id, transport;

-- Verify collector IDs are set
SELECT store_id, studio_collector_id
FROM stores
WHERE method IS NOT NULL AND method <> 'none'
ORDER BY store_id;
```

Stores with `has_endpoint = false` and `method` in (`sitemap`,
`sitemap-bounded`) will return 0 rows from HTTP cron because the
sitemap adapter requires an endpoint. The Studio-only pipeline fixes
this: Studio uses its own seed URLs from the manifest, not the
`stores.endpoint` column.
