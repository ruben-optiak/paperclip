FROM ghcr.io/astral-sh/uv:0.8.15-python3.12-bookworm-slim@sha256:0664f9b563fb559314ae82b9d87cd34d503f98a96d8cd9b37fd9d9cfe76d5ede

LABEL org.opencontainers.image.title="Enki catalogue pipeline" \
      org.opencontainers.image.version="0.3.0" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    UV_CACHE_DIR=/tmp/uv-cache

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project \
    && rm -rf /tmp/uv-cache

COPY src ./src
COPY adapters ./adapters
RUN chmod -R a=rX /app

USER 65532:65532
ENTRYPOINT ["/app/.venv/bin/python", "-m", "enki_catalog_pipeline"]
