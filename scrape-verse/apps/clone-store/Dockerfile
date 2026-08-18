# Build context: repo root (scrape-verse/)
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY apps/clone-store/server.js .
EXPOSE 3002
CMD ["node", "server.js"]
