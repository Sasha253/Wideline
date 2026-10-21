# syntax=docker/dockerfile:1.7
# Targets:
#   dev     - local development; source is bind-mounted by docker compose
#   web     - production Next.js server (standalone output)
#   worker  - production transcode worker (needs ffmpeg)

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ffmpeg for the transcode worker; docker CLI so the CV dispatcher can start
# the cv_worker image in local development (CV_DISPATCH=docker).
FROM base AS dev
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates docker.io \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

# Runtime images carry no package managers: npm and corepack are not needed to
# run the app, and npm's bundled dependencies show up in container scans.
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && groupadd -r app && useradd -r -g app app
WORKDIR /app

FROM runtime AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
CMD ["node", "server.js"]

FROM runtime AS worker
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY package.json tsconfig.json ./
USER app
CMD ["node", "--import", "tsx", "src/worker/index.ts"]
