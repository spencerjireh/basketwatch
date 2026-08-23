import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { scrubSecrets } from "../../common/scrub.js";
import { FleetRepository } from "./fleet.repository.js";

const run = promisify(execFile);

const CLI_TIMEOUT_MS = 15 * 60 * 1000;

interface ManifestEntry {
  storeId: string;
  name: string;
  seedUrl: string;
  description: string;
  template: string;
  maxUrls: number;
}

interface Manifest {
  collectors: ManifestEntry[];
}

export interface ProvisionResult {
  storeId: string;
  collectorId: string | null;
  status: "created" | "already_exists" | "failed";
  error?: string;
}

/**
 * Creates Studio collectors on the configured Bright Data account by reading
 * descriptions from the collector manifest and shelling out to the CLI.
 *
 * Each call to `provisionStore` is idempotent: if the store already has a
 * `studio_collector_id`, it is returned without creating a duplicate.
 */
@Injectable()
export class ProvisionService {
  private readonly logger = new Logger(ProvisionService.name);
  private readonly apiKey = process.env.BRIGHTDATA_API_KEY ?? "";
  private manifest: Manifest | null = null;

  constructor(private readonly repository: FleetRepository) {}

  private async loadManifest(): Promise<Manifest> {
    if (this.manifest) return this.manifest;
    const candidates = [
      path.resolve("docs/collector-manifest.json"),
      path.resolve("../../docs/collector-manifest.json"),
      path.resolve("/app/collector-manifest.json"),
    ];
    for (const p of candidates) {
      try {
        const raw = await readFile(p, "utf8");
        this.manifest = JSON.parse(raw) as Manifest;
        this.logger.log(`loaded manifest from ${p} (${this.manifest.collectors.length} entries)`);
        return this.manifest;
      } catch {
        continue;
      }
    }
    throw new NotFoundException(
      "collector-manifest.json not found. Expected at docs/collector-manifest.json or /app/collector-manifest.json",
    );
  }

  /**
   * Provision a single store's Studio collector. Idempotent: if the store
   * already has a `studio_collector_id` in the database, the existing id is
   * returned without touching Bright Data. Otherwise, looks up the store in
   * the collector manifest, shells out to the CLI to create the collector,
   * and wires the new id into the scrapers and stores tables.
   *
   * For listing-page collectors, also sets the `studio_endpoint` so the
   * Studio adapter knows which URL to submit.
   */
  async provisionStore(storeId: string): Promise<ProvisionResult> {
    const existing = await this.repository.getCollectorId(storeId);
    if (existing) {
      return { storeId, collectorId: existing, status: "already_exists" };
    }

    const manifest = await this.loadManifest();
    const entry = manifest.collectors.find((c) => c.storeId === storeId);
    if (!entry) {
      throw new NotFoundException(`No manifest entry for store ${storeId}`);
    }

    try {
      const collectorId = await this.createCollector(entry);
      await this.repository.upsertScraper(collectorId, entry.name, entry.seedUrl);
      await this.repository.setCollectorId(storeId, collectorId);
      if (entry.template === "listing-page") {
        await this.repository.setStudioEndpoint(storeId, entry.seedUrl);
      }
      this.logger.log(`${storeId}: provisioned collector ${collectorId}`);
      return { storeId, collectorId, status: "created" };
    } catch (err: unknown) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      const message = scrubSecrets(stderr || (err instanceof Error ? err.message : String(err)), [
        this.apiKey,
      ]);
      this.logger.error(`${storeId}: provision failed -- ${message}`);
      return { storeId, collectorId: null, status: "failed", error: message.slice(0, 500) };
    }
  }

  async provisionAll(): Promise<ProvisionResult[]> {
    const manifest = await this.loadManifest();
    const results: ProvisionResult[] = [];
    for (const entry of manifest.collectors) {
      const result = await this.provisionStore(entry.storeId);
      results.push(result);
    }
    return results;
  }

  async unprovisionedStores(): Promise<string[]> {
    const manifest = await this.loadManifest();
    const missing: string[] = [];
    for (const entry of manifest.collectors) {
      const id = await this.repository.getCollectorId(entry.storeId);
      if (!id) missing.push(entry.storeId);
    }
    return missing;
  }

  /**
   * Shell out to `brightdata scraper create` with the manifest entry's seed
   * URL and description. Parses the JSON response for the new collector id.
   *
   * API keys are never logged; errors are scrubbed through `scrubSecrets`
   * before surfacing. The CLI is given a generous timeout because Bright
   * Data's creation flow includes an initial crawl of the seed URL.
   */
  private async createCollector(entry: ManifestEntry): Promise<string> {
    const args = [
      ...(this.apiKey ? ["-k", this.apiKey] : []),
      "scraper",
      "create",
      entry.seedUrl,
      entry.description,
      "--name",
      entry.name,
      "--timeout",
      "900",
    ];

    // Never log args: args[1] is the API key when one is configured.
    this.logger.log(
      `creating collector for ${entry.storeId}: brightdata scraper create ${entry.seedUrl}`,
    );

    let stdout: string;
    let stderr: string;
    try {
      const result = await run("brightdata", args, {
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        encoding: "utf8",
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: string };
      const detail = scrubSecrets(
        e.stderr || e.stdout || (err instanceof Error ? err.message : String(err)),
        [this.apiKey],
      );
      throw new Error(`CLI failed (${e.code ?? "unknown"}): ${detail.slice(0, 400)}`);
    }

    if (stderr) {
      this.logger.warn(`CLI stderr: ${scrubSecrets(stderr.slice(0, 200), [this.apiKey])}`);
    }

    const parsed = JSON.parse(stdout) as { collector_id?: string; status?: string };
    if (!parsed.collector_id) {
      throw new Error(`CLI returned no collector_id: ${stdout.slice(0, 200)}`);
    }
    return parsed.collector_id;
  }
}
