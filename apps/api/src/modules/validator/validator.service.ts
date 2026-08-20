import { Injectable } from "@nestjs/common";
import { type Verdict } from "@basketwatch/contract";

/**
 * The impure edge around the pure checks: loads a baseline, runs the checks,
 * opens an incident with its evidence bundle, and enqueues a heal.
 *
 * Keeping this separate from checks.ts is what lets an incident be replayed
 * from its stored raw_output against rules that did not exist when it opened.
 */
@Injectable()
export class ValidatorService {
  async validateStoredRun(_runId: string): Promise<Verdict> {
    throw new Error("not implemented");
  }
}
