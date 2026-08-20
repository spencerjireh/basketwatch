import config from "@basketwatch/eslint-config/base";

// Global ignores are declared here rather than in the shared config: ESLint 9
// resolves a shared config's ignore patterns against that config's own
// directory, so they would not match this package's build output.
export default [
  { ignores: ["dist/**", ".turbo/**"] },
  ...config,
];
