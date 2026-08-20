# Build context: basketwatch/ (the monorepo root), NOT the git repo root.
FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN npm install -g pnpm@11.10.0
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contract/package.json packages/contract/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
# Next bakes rewrites() into the routes manifest at build time, so the API
# address has to be known here rather than injected into the running container.
# The default is the compose service name, which is what prod uses.
ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=$API_INTERNAL_URL
COPY . .
RUN pnpm turbo run build --filter=@basketwatch/web

# ---- runtime: Next standalone. No pnpm here, and no node_modules copy. ----
FROM node:24-alpine AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
# output: "standalone" plus outputFileTracingRoot at the monorepo root emits a
# server with its own traced node_modules of real files, which sidesteps pnpm's
# symlink layout entirely.
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
