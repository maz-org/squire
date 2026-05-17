# syntax=docker/dockerfile:1

FROM node:26.1.0-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM deps AS assets

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node tailwind.config.js ./tailwind.config.js
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
RUN npm run build:web-assets

FROM node:26.1.0-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV SQUIRE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

COPY --from=deps /app/node_modules ./node_modules
COPY --from=assets /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node

CMD ["node", "src/server.ts"]
