FROM node:22-bookworm-slim AS web-builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN corepack enable && pnpm install --frozen-lockfile

COPY apps/web apps/web
RUN pnpm --dir apps/web build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    HOME=/data

RUN addgroup --system diagramc && adduser --system --ingroup diagramc --home /data diagramc \
    && mkdir -p /app /data \
    && chown -R diagramc:diagramc /app /data

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src src
COPY schemas schemas
COPY themes themes
COPY --from=web-builder /app/apps/web/dist apps/web/dist
RUN pip install --no-cache-dir .

COPY docker-entrypoint.sh /usr/local/bin/diagramc
RUN chmod 755 /usr/local/bin/diagramc

USER diagramc
VOLUME ["/data"]
EXPOSE 8765
ENTRYPOINT ["diagramc"]
