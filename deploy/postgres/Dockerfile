# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG POSTGRES_IMAGE=postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15

FROM ${POSTGRES_IMAGE} AS pgvector-build
ARG PGVECTOR_VERSION=0.8.5
ARG PGVECTOR_SHA256=6f88a5cbdde31666f4b6c1a6b75c51dcbeffe58f9a7d2b26e502d5a6e5e14d44

# Build-only packages never enter the runtime image.
# hadolint ignore=DL3018
RUN apk add --no-cache build-base clang21 llvm21-dev
ADD --checksum=sha256:${PGVECTOR_SHA256} \
  https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz \
  /tmp/pgvector.tar.gz
RUN mkdir /tmp/pgvector \
  && tar --extract --gzip --file /tmp/pgvector.tar.gz --directory /tmp/pgvector --strip-components=1 \
  && make -C /tmp/pgvector OPTFLAGS='' \
  && make -C /tmp/pgvector DESTDIR=/install install

FROM ${POSTGRES_IMAGE} AS runtime
LABEL org.opencontainers.image.title="supplier-henkaten-postgres" \
  org.opencontainers.image.source="https://github.com/khalshaqzzy/supplier-henkaten" \
  org.opencontainers.image.version="18.4-pgvector-0.8.5"

# Apply the distribution security repository and remove the root-switch helper;
# Compose always starts this image as the PostgreSQL uid.
# hadolint ignore=DL3018
RUN apk upgrade --no-cache \
  && rm -f /usr/local/bin/gosu
COPY --from=pgvector-build /install/ /

USER 70:70
