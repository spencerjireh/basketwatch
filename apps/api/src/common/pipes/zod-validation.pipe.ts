import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

/**
 * Validates one input against a contract schema.
 *
 * Inputs are validated at runtime because they come from outside. Outputs are
 * not: a handler's return type is `z.infer<typeof schema>`, so the compiler
 * enforces the response shape at zero runtime cost. A response interceptor can
 * be added later if a shape ever escapes, but the type-level guarantee is the
 * one that matters.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Request does not match the expected shape.",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
