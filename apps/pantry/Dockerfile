# Parker's Pantry is dependency-free on purpose: no pnpm, no build step,
# just node and one file. Keeping it out of the workspace install means a
# broken lockfile can never take the demo rig down with it.
FROM node:24-alpine

WORKDIR /app
RUN addgroup -S app && adduser -S app -G app

COPY apps/pantry/server.js ./

ENV NODE_ENV=production PORT=3002
USER app
EXPOSE 3002

CMD ["node", "server.js"]
