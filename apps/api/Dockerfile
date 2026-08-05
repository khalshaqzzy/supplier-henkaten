# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG NODE_IMAGE=node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
ARG RUNTIME_IMAGE=gcr.io/distroless/cc-debian12:nonroot@sha256:fccdbb0a547c14e23fcf4ce8ad62ca5d43b4faae8d22cd292f490fef9946c96e

FROM ${NODE_IMAGE} AS build
ENV PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x,linux-arm64-openssl-3.0.x
WORKDIR /workspace

# Debian security repositories select the patched OpenSSL build for this pinned base digest.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.js ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/test-fixtures/package.json packages/test-fixtures/package.json
RUN --mount=type=cache,id=supplier-henkaten-pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --filter @tmmin-henkaten/api... --filter @tmmin-henkaten/contracts --filter @tmmin-henkaten/test-fixtures \
  && engine_postinstall="$(find node_modules/.pnpm -path '*/@prisma/engines/scripts/postinstall.js' -type f -print -quit)" \
  && test -n "${engine_postinstall}" \
  && node "${engine_postinstall}"

COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/test-fixtures packages/test-fixtures
RUN --mount=type=cache,id=supplier-henkaten-pnpm,target=/root/.local/share/pnpm/store \
  pnpm --filter @tmmin-henkaten/api run generate \
  && pnpm --filter @tmmin-henkaten/contracts run build \
  && pnpm --filter @tmmin-henkaten/test-fixtures run build \
  && pnpm --filter @tmmin-henkaten/api run build \
  && pnpm --filter @tmmin-henkaten/api deploy --prod --legacy /opt/api \
  && deployed_engine_postinstall="$(find /opt/api/node_modules/.pnpm -path '*/@prisma/engines/scripts/postinstall.js' -type f -print -quit)" \
  && test -n "${deployed_engine_postinstall}" \
  && node "${deployed_engine_postinstall}"

FROM ${RUNTIME_IMAGE} AS runtime
ARG RELEASE_SHA=unknown
LABEL org.opencontainers.image.title="supplier-henkaten-api" \
  org.opencontainers.image.revision="${RELEASE_SHA}" \
  org.opencontainers.image.source="https://github.com/khalshaqzzy/supplier-henkaten"

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  PATH=/nodejs/bin
WORKDIR /app

COPY --from=build /usr/local/bin/node /nodejs/bin/node
COPY --from=build --chown=65532:65532 /opt/api/ ./

USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=18 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/ready').then(async(r)=>{const b=await r.json();if(!r.ok||b.status!=='ready')process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
