import { describe, expect, it } from "vitest";
import { scrubDeep, scrubSecrets } from "./scrub.js";

const KEY = "dfbe0000-dead-beef-0000-000000000000";

describe("scrubSecrets", () => {
  it("removes the secret literal wherever it appears", () => {
    const msg = `Command failed: brightdata -k ${KEY} scraper run c_abc --json\nsome stderr`;
    const out = scrubSecrets(msg, [KEY]);
    expect(out).not.toContain(KEY);
    expect(out).toContain("scraper run c_abc");
  });

  it("redacts -k arguments even when the literal is not supplied", () => {
    const out = scrubSecrets(`brightdata -k ${KEY} scraper create`);
    expect(out).not.toContain(KEY);
    expect(out).toContain("-k [REDACTED]");
  });

  it("redacts --key= form and Bearer tokens", () => {
    expect(scrubSecrets("curl --key=sekrit http://x")).not.toContain("sekrit");
    expect(scrubSecrets("Authorization: Bearer abc.def.ghi")).toBe(
      "Authorization: Bearer [REDACTED]",
    );
  });

  it("leaves clean text untouched", () => {
    const msg = "collector returned an unrecognised JSON envelope";
    expect(scrubSecrets(msg, [KEY])).toBe(msg);
  });

  it("ignores empty secrets rather than exploding the string", () => {
    expect(scrubSecrets("plain", [""])).toBe("plain");
  });
});

describe("scrubDeep", () => {
  it("scrubs strings nested in objects and arrays, preserving shape", () => {
    const detail = {
      code: 1,
      stderrTail: `auth with -k ${KEY} failed`,
      chain: [{ note: `Bearer ${KEY}` }],
    };
    const out = scrubDeep(detail, [KEY]);
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(out.code).toBe(1);
    expect(out.chain[0]?.note).toBe("Bearer [REDACTED]");
  });
});
