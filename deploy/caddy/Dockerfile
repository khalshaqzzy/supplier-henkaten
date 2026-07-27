# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG GO_IMAGE=golang:1.25.12-alpine@sha256:56961d79ea8129efddcc0b8643fd8a5416b4e6228cfd477e3fd61deb2672c587
ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot@sha256:f5b485ea962d9bd1186b2f6b3a061191539b905b82ec395de78cbfae51f20e35

FROM ${GO_IMAGE} AS build
WORKDIR /build

RUN --mount=type=cache,id=supplier-henkaten-go-mod,target=/go/pkg/mod \
  --mount=type=cache,id=supplier-henkaten-go-build,target=/root/.cache/go-build \
  go mod init supplier-henkaten/caddy \
  && go get github.com/caddyserver/caddy/v2/cmd/caddy@v2.11.4 \
  && go get google.golang.org/grpc@v1.82.1 \
  && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/caddy github.com/caddyserver/caddy/v2/cmd/caddy

FROM ${RUNTIME_IMAGE} AS runtime
ARG RELEASE_SHA=unknown
LABEL org.opencontainers.image.title="supplier-henkaten-caddy" \
  org.opencontainers.image.revision="${RELEASE_SHA}" \
  org.opencontainers.image.source="https://github.com/khalshaqzzy/supplier-henkaten" \
  org.opencontainers.image.version="2.11.4"

ENV XDG_CONFIG_HOME=/config \
  XDG_DATA_HOME=/data
COPY --from=build /out/caddy /usr/bin/caddy

USER 65532:65532
EXPOSE 80 443 443/udp
ENTRYPOINT ["/usr/bin/caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
