import base from "./base.js";

/**
 * API rules.
 *
 * The no-restricted-imports block is an architectural boundary expressed as a
 * lint rule rather than as a convention nobody remembers: it is what keeps
 * queries out of controllers as the codebase grows. Repositories are the only
 * files allowed to touch the Drizzle schema, and they return contract types,
 * never raw rows.
 */
export default [
  ...base,
  {
    files: ["src/**/*.ts"],
    rules: {
      // Decorator-heavy code legitimately has empty constructors and classes.
      "@typescript-eslint/no-extraneous-class": "off",

      // OFF, deliberately, and do not turn it back on for this package.
      //
      // NestJS resolves constructor dependencies from the design:paramtypes
      // metadata that TypeScript emits. That emit needs a real value import of
      // the injected class. Rewriting `import { ConfigService }` to
      // `import type { ConfigService }` -- which this rule does, and which its
      // autofix does silently across every file at once -- erases the reference,
      // degrades the emitted metadata to Object, and injection starts handing
      // providers `undefined` at runtime. It compiles, it lints, and it fails
      // only when the endpoint is called.
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  {
    files: ["src/modules/**/*.ts"],
    ignores: ["src/modules/**/*.repository.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/database/schema", "**/database/schema.js", "drizzle-orm/pg-core"],
              message:
                "Only *.repository.ts may touch the Drizzle schema. Move the query into the module's repository and return a contract type.",
            },
          ],
        },
      ],
    },
  },
];
