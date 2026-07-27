# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG NODE_IMAGE=node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
ARG STATIC_IMAGE=nginxinc/nginx-unprivileged:1.31.3-alpine@sha256:18d67281256ded39ff65e010ae4f831be18f19356f83c60bc546492c7eb6dd23

FROM ${NODE_IMAGE} AS build
ARG RELEASE_SHA=unknown
ARG VITE_API_ORIGIN
ENV VITE_API_ORIGIN=${VITE_API_ORIGIN}
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.16.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.js ./
COPY apps/supplier-web/package.json apps/supplier-web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN --mount=type=cache,id=supplier-henkaten-pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --filter @tmmin-henkaten/supplier-web... --filter @tmmin-henkaten/api-client --filter @tmmin-henkaten/contracts --filter @tmmin-henkaten/ui

COPY apps/supplier-web apps/supplier-web
COPY packages/api-client packages/api-client
COPY packages/contracts packages/contracts
COPY packages/ui packages/ui
RUN pnpm --filter @tmmin-henkaten/contracts run build \
  && pnpm --filter @tmmin-henkaten/api-client run build \
  && pnpm --filter @tmmin-henkaten/ui run build \
  && pnpm --filter @tmmin-henkaten/supplier-web run build \
  && node --input-type=module -e "import{writeFileSync}from'node:fs';writeFileSync('apps/supplier-web/dist/release.json',JSON.stringify({application:'supplier-web',releaseSha:process.argv[1]})+'\\n')" "${RELEASE_SHA}"

FROM ${STATIC_IMAGE} AS runtime
ARG RELEASE_SHA=unknown
LABEL org.opencontainers.image.title="supplier-henkaten-supplier-web" \
  org.opencontainers.image.revision="${RELEASE_SHA}" \
  org.opencontainers.image.source="https://github.com/khalshaqzzy/supplier-henkaten"

COPY deploy/nginx/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /workspace/apps/supplier-web/dist/ /usr/share/nginx/html/

USER 101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=12 \
  CMD ["wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:8080/healthz"]
