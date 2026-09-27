import base from "./base.js";

/**
 * Dashboard rules.
 *
 * Next is a pure client of the API. The restricted imports below make that
 * structural rather than aspirational: there is no way to open a database
 * connection from the web app, by construction.
 */
export default [
  ...base,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "drizzle-orm",
              message: "The dashboard is a pure API client. Fetch it from /api instead.",
            },
            {
              name: "postgres",
              message: "The dashboard is a pure API client. Fetch it from /api instead.",
            },
            {
              name: "pg",
              message: "The dashboard is a pure API client. Fetch it from /api instead.",
            },
            {
              name: "pg-boss",
              message: "The dashboard is a pure API client. Fetch it from /api instead.",
            },
          ],
        },
      ],
    },
  },
];
