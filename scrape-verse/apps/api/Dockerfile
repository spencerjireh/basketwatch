# Build context: repo root (scrape-verse/)
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace apps/api --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w apps/api

FROM node:20-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/package.json apps/api/
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
