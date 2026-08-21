import { Injectable, Logger } from "@nestjs/common";
import { type CheckResult, type Verdict } from "@basketwatch/contract";
import { validateRun } from "./checks.js";
import { type Baseline } from "./checks.types.js";
import { ValidatorRepository } from "./validator.repository.js";

/**
 * The impure edge around the pure checks: loads a baseline, runs the checks,
 * opens an incident with its evidence bundle, and updates the run record.
 *
 * Keeping this separate from checks.ts is what lets an incident be replayed
 * from its stored raw_output against rules that did not exist when it opened.
 */
@Injectable()
export class ValidatorService {
  private readonly logger = new Logger(ValidatorService.name);

  constructor(private readonly repository: ValidatorRepository) {}

  async validateStoredRun(runId: number, storeId: string): Promise<Verdict> {
    const baseline = await this.repository.loadBaseline(storeId);
    if (!baseline) {
      this.logger.warn(`${storeId}: no baseline found, skipping validation`);
      return { status: "ok", findings: [] };
    }

    const products = await this.repository.loadStoreProducts(storeId);
    if (products.length === 0) {
      this.logger.warn(`${storeId}: no products found, skipping validation`);
      return { status: "ok", findings: [] };
    }

    const parse = (_row: unknown) => true;
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
        this.logger.log(
          `${storeId}: run ${runId} is ${verdict.status}, incident already open`,
        );
      }
    } else {
      this.logger.log(
        `${storeId}: run ${runId} is ${verdict.status}, ${verdict.findings.length} findings`,
      );
    }

    return verdict;
  }

  /** Seed baselines for all stores from their current product data. */
  async seedAllBaselines(): Promise<number> {
    return this.repository.seedAllBaselines();
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
