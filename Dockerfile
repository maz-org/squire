# syntax=docker/dockerfile:1

FROM node:24.14.0-bookworm-slim AS deps

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

FROM node:24.14.0-bookworm-slim AS runtime

WORKDIR /app

ARG TARGETARCH
ENV SUPERCRONIC_VERSION=v0.2.45
ENV NODE_ENV=production
ENV SQUIRE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && case "${TARGETARCH:-amd64}" in \
    "amd64") SUPERCRONIC="supercronic-linux-amd64"; SUPERCRONIC_SHA1SUM="e894b193bea75a5ee644e700c59e30eedc804cf7" ;; \
    "arm64") SUPERCRONIC="supercronic-linux-arm64"; SUPERCRONIC_SHA1SUM="20ce6dace414a64f0632f4092d6d3745db6085ad" ;; \
    *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && curl -fsSLO "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/${SUPERCRONIC}" \
  && echo "${SUPERCRONIC_SHA1SUM}  ${SUPERCRONIC}" | sha1sum -c - \
  && chmod +x "${SUPERCRONIC}" \
  && mv "${SUPERCRONIC}" "/usr/local/bin/${SUPERCRONIC}" \
  && ln -s "/usr/local/bin/${SUPERCRONIC}" /usr/local/bin/supercronic \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=assets /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node crontab ./crontab

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node

CMD ["node", "src/server.ts"]
