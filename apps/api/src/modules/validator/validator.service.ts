import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { type CheckResult, type Verdict } from "@basketwatch/contract";
import { z } from "zod";
import { validateRun } from "./checks.js";
import { type Baseline } from "./checks.types.js";
import { ValidatorRepository } from "./validator.repository.js";

/**
 * Schema for stored products as returned by loadStoreProducts(). Distinct from
 * priceRecordSchema because stored rows lack observed_at and have nullable size
 * fields. A row failing this means a core field (name, price, url) was lost --
 * the exact symptom of an adapter that stopped understanding the site.
 */
const storedProductSchema = z.object({
  product_key: z.string().min(1),
  name: z.string().min(1),
  price: z.number().positive(),
  // Exactly a code, never a label: a collector once echoed "USD 11.99" here,
  // which the read contract rejects. Length-checked so that lands as an
  // incident instead of a silently green run. Nullable because nullness is
  // the null-rates check's job, not a schema failure.
  currency: z.string().length(3).nullable(),
  url: z.string().min(1),
});

/**
 * The impure edge around the pure checks: loads a baseline, runs the checks,
 * opens or resolves incidents, and updates the run record.
 *
 * Keeping this separate from checks.ts is what lets an incident be replayed
 * from its stored evidence against rules that did not exist when it opened.
 */
@Injectable()
export class ValidatorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ValidatorService.name);

  constructor(private readonly repository: ValidatorRepository) {}

  async onApplicationBootstrap(): Promise<void> {
    const count = await this.repository.seedAllBaselines();
    this.logger.log(`seeded baselines for ${count} stores`);
  }

  /**
   * Validate a completed run against the store's rolling baseline.
   *
   * 1. Loads the baseline (expected row count, field null rates, value
   *    ranges). If none exists this is a first run, delegated to
   *    `handleFirstRun` which seeds or rejects.
   * 2. Runs the pure check suite (schema parse rate, row count, null rates,
   *    price drift) -- all in `checks.ts`, IO-free and unit-tested.
   * 3. Persists findings and the run's verdict.
   * 4. On a `broken` verdict, opens an incident (if one is not already open)
   *    with the findings as evidence. On an `ok` verdict, resolves whatever
   *    incident was open: the store came back, and the record should say so.
   */
  async validateStoredRun(runId: number, storeId: string): Promise<Verdict> {
    const baseline = await this.repository.loadBaseline(storeId);

    const products = await this.repository.loadStoreProducts(storeId);
    if (products.length === 0) {
      this.logger.warn(`${storeId}: no products found, skipping validation`);
      return { status: "ok", findings: [] };
    }

    const parse = (row: unknown) => storedProductSchema.safeParse(row).success;

    if (!baseline) {
      return this.handleFirstRun(runId, storeId, products, parse);
    }

    const verdict = validateRun(products, parse, baseline);

    const nullRatePct = this.computeNullRatePct(products);

    await this.repository.updateRunFindings(runId, verdict, nullRatePct, verdict.status);

    if (verdict.status === "broken") {
      const hasOpen = await this.repository.hasOpenIncident(storeId);
      if (!hasOpen) {
        const evidence = this.buildEvidence(verdict.findings, products, baseline);
        const incidentKind = this.pickIncidentKind(verdict.findings);
        await this.repository.openIncident(storeId, runId, incidentKind, evidence);
        this.logger.log(
          `${storeId}: run ${runId} is ${verdict.status}, incident opened (${incidentKind})`,
        );
      } else {
        this.logger.log(`${storeId}: run ${runId} is ${verdict.status}, incident already open`);
      }
    } else {
      this.logger.log(
        `${storeId}: run ${runId} is ${verdict.status}, ${verdict.findings.length} findings`,
      );
      // Only a run that applied rows reaches validation, so an `ok` here is a
      // store that pulls and parses again. Without this the open incident
      // would outlive the breakage and, through hasOpenIncident, swallow the
      // next real one.
      if (verdict.status === "ok") {
        const resolved = await this.repository.resolveOpenIncidents(storeId);
        if (resolved > 0)
          this.logger.log(`${storeId}: recovered, ${resolved} incident(s) resolved`);
      }
    }

    return verdict;
  }

  /** Seed baselines for all stores from their current product data. */
  async seedAllBaselines(): Promise<number> {
    return this.repository.seedAllBaselines();
  }

  /** Update a single store's baseline after a successful validation. */
  async updateBaseline(storeId: string): Promise<void> {
    await this.repository.computeAndSeedBaseline(storeId);
  }

  private computeNullRatePct(products: Record<string, unknown>[]): number {
    if (products.length === 0) return 0;

    const fields = ["name", "price", "size_value", "size_uom"];
    let totalNulls = 0;
    let totalChecks = 0;

    for (const field of fields) {
      for (const product of products) {
        totalChecks++;
        const v = product[field];
        if (v === null || v === undefined || v === "") totalNulls++;
      }
    }

    return totalChecks === 0 ? 0 : (totalNulls / totalChecks) * 100;
  }

  /**
   * First run for a store: no baseline exists yet. Validate the schema; if ok,
   * seed the baseline from this run. If not, open an incident immediately.
   */
  private async handleFirstRun(
    runId: number,
    storeId: string,
    products: Record<string, unknown>[],
    parse: (row: unknown) => boolean,
  ): Promise<Verdict> {
    const parseRate = products.filter((p) => parse(p)).length / products.length;
    const priceRate =
      products.filter((p) => p.price !== null && p.price !== undefined).length / products.length;
    const nameRate =
      products.filter((p) => p.name !== null && p.name !== undefined && p.name !== "").length /
      products.length;

    const schemaOk = parseRate >= 0.7;
    const priceOk = priceRate >= 0.5;
    const nameOk = nameRate >= 0.5;

    if (schemaOk && priceOk && nameOk) {
      this.logger.log(
        `${storeId}: first run looks healthy (parse=${(parseRate * 100).toFixed(0)}%, price=${(priceRate * 100).toFixed(0)}%, name=${(nameRate * 100).toFixed(0)}%), seeding baseline`,
      );

      await this.repository.computeAndSeedBaseline(storeId);
      await this.repository.updateRunFindings(runId, [], 0, "ok");
      return { status: "ok", findings: [] };
    }

    const findings: CheckResult[] = [];
    if (!schemaOk) {
      findings.push({
        check: "schema",
        severity: "hard",
        detail: `Schema parse rate ${(parseRate * 100).toFixed(0)}% is below 70% threshold on first run`,
      });
    }
    if (!priceOk) {
      findings.push({
        check: "nulls",
        severity: "hard",
        detail: `Price field present in only ${(priceRate * 100).toFixed(0)}% of rows on first run`,
      });
    }
    if (!nameOk) {
      findings.push({
        check: "nulls",
        severity: "soft",
        detail: `Name field present in only ${(nameRate * 100).toFixed(0)}% of rows on first run`,
      });
    }

    // The findings are recorded on the run either way; the incident is what
    // gets deduped, exactly as on the main validation path above.
    if (await this.repository.hasOpenIncident(storeId)) {
      this.logger.warn(`${storeId}: first run failed validation, incident already open`);
      await this.repository.updateRunFindings(runId, findings, 0, "broken");
      return { status: "broken", findings };
    }

    this.logger.warn(`${storeId}: first run failed validation, opening incident`);

    const emptyBaseline: Baseline = { expectedRowCount: 0, fieldNullRates: {}, valueRanges: {} };
    const evidence = this.buildEvidence(findings, products, emptyBaseline);
    const incidentKind = this.pickIncidentKind(findings);
    await this.repository.openIncident(storeId, runId, incidentKind, evidence);
    await this.repository.updateRunFindings(runId, findings, 0, "broken");

    return { status: "broken", findings };
  }

  private buildEvidence(
    findings: CheckResult[],
    products: Record<string, unknown>[],
    baseline: Baseline,
  ): Record<string, unknown> {
    const fieldNullRates: Record<string, number> = {};
    const fields = ["name", "url", "price", "currency", "in_stock", "size_value", "size_uom"];

    for (const field of fields) {
      const nullCount = products.filter((p) => {
        const v = p[field];
        return v === null || v === undefined || v === "";
      }).length;
      fieldNullRates[field] = products.length > 0 ? nullCount / products.length : 0;
    }

    return {
      kind: this.pickIncidentKind(findings),
      failedChecks: findings,
      sampleBadRows: products.filter((p) => p.price === null).slice(0, 5),
      sampleGoodRows: products.filter((p) => p.price !== null).slice(0, 5),
      fieldNullRates,
      baselineNullRates: baseline.fieldNullRates,
      rowCount: products.length,
      expectedRowCount: baseline.expectedRowCount,
    };
  }

  private pickIncidentKind(findings: CheckResult[]): string {
    const hardFindings = findings.filter((f) => f.severity === "hard");
    if (hardFindings.length === 0) return "nulls";
    const checks = hardFindings.map((f) => f.check);
    if (checks.includes("schema")) return "schema";
    if (checks.includes("rowcount")) return "rowcount";
    if (checks.includes("nulls")) return "nulls";
    return "drift";
  }
}
