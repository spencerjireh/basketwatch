# Build context: the repo root, which is also the workspace root.
# Everything not excluded by .dockerignore is transferred and baked in by
# the `COPY . .` below -- including .env and lab/ if that file is wrong.
FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
# npm i -g rather than corepack: deterministic, and no corepack signature-key
# fetch to fail in a sandboxed builder. Keep in step with the root
# packageManager field.
RUN npm install -g pnpm@11.10.0
WORKDIR /repo

# ---- deps: manifests only, so this layer caches until the lockfile moves ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/pantry/package.json apps/pantry/
COPY packages/contract/package.json packages/contract/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build: contract first, then the api, ordered by turbo ----
FROM deps AS build
COPY . .
RUN pnpm turbo run build --filter=@basketwatch/api
# pnpm deploy materialises a self-contained node_modules: workspace packages are
# copied in as real directories rather than symlinks, which is what makes the
# runtime stage's COPY work at all. --legacy is required on pnpm 10+ unless
# inject-workspace-packages is enabled globally.
RUN pnpm deploy --filter=@basketwatch/api --prod --legacy /prod/api

# ---- runtime ----
FROM node:24-alpine AS runner
ENV NODE_ENV=production PORT=3001
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
# Bright Data CLI: the Studio adapter shells out to `brightdata scraper run`.
RUN npm install -g @brightdata/cli
COPY --from=build --chown=app:app /prod/api ./
# The migration SQL, applied by the API itself on boot. `files` in
# apps/api/package.json carries it into /prod/api; this line is what makes a
# missing entry there fail the build rather than the deploy.
COPY --from=build --chown=app:app /repo/apps/api/drizzle ./drizzle
COPY --from=build --chown=app:app /repo/docs/collector-manifest.json ./collector-manifest.json
USER app
EXPOSE 3001
CMD ["node", "dist/main.js"]
