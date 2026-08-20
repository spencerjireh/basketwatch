import config from "@basketwatch/eslint-config/nest";

export default [{ ignores: ["dist/**", ".turbo/**", "drizzle/**"] }, ...config];
