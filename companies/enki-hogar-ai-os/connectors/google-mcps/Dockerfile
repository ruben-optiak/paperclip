FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57 AS node-runtime
FROM ghcr.io/astral-sh/uv:0.8.15-python3.12-bookworm-slim@sha256:0664f9b563fb559314ae82b9d87cd34d503f98a96d8cd9b37fd9d9cfe76d5ede

COPY --from=node-runtime /usr/local/ /usr/local/
ENV UV_TOOL_BIN_DIR=/usr/local/bin \
    UV_TOOL_DIR=/opt/uv-tools \
    UV_CACHE_DIR=/var/cache/uv \
    PATH=/app/.venv/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /app
COPY connectors/google-mcps/pyproject.toml connectors/google-mcps/uv.lock ./
COPY connectors/google-mcps/package.json connectors/google-mcps/package-lock.json ./

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && uv sync --frozen --no-dev --no-install-project \
    && npm ci --omit=dev --ignore-scripts \
    && ln -s /app/node_modules/.bin/gsc-mcp-server /usr/local/bin/gsc-mcp-server \
    && apt-get purge --yes git \
    && apt-get autoremove --yes \
    && rm -rf /var/lib/apt/lists/* /var/cache/uv /root/.npm

COPY connectors/google-mcps/config ./config
COPY connectors/google-mcps/*.mjs connectors/google-mcps/run-google-mcps.sh ./
RUN chmod 0555 /app/run-google-mcps.sh

EXPOSE 8010 8011 8012
HEALTHCHECK --interval=30s --timeout=8s --retries=3 CMD node /app/google-services-health.mjs
CMD ["/app/run-google-mcps.sh"]
