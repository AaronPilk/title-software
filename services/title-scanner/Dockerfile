# Official Linux/amd64 images verified 2026-09-24. Refresh through a reviewed image build.
FROM docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS dependencies
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM docker.io/clamav/clamav:1.5.4_base@sha256:6d954ba640e9252a267b45ea748163ba9f8ab8ecad315264a4c6cfe947e654d9
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=dependencies /build/node_modules ./node_modules
COPY package.json ./
COPY src ./src
RUN mkdir -p /run/title-scanner /var/lib/clamav && chown clamav:clamav /run/title-scanner /var/lib/clamav && chmod 700 /run/title-scanner /var/lib/clamav && node --version
USER clamav
ENV TZ=UTC TITLE_SCANNER_TRANSPORT=cloudflare-private-http TITLE_SCANNER_HOST=0.0.0.0 TITLE_SCANNER_PORT=8080
EXPOSE 8080
# The upstream healthcheck expects its default daemon config; use authenticated API readiness instead.
HEALTHCHECK NONE
ENTRYPOINT ["/sbin/tini", "--", "node", "src/container.mjs"]
