# SAQR node: pipeline + API + dashboard. Based on the official Playwright image (Chromium preinstalled).
FROM mcr.microsoft.com/playwright/python:v1.63.0-noble

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    SAQR_HOST=0.0.0.0 SAQR_PORT=8000 SAQR_DATA_DIR=/data \
    SAQR_DEMO_SITES_DIR=/app/demo/sites SAQR_FRONTEND_DIST=/app/frontend/dist

WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY saqr ./saqr
COPY demo ./demo
COPY frontend/dist ./frontend/dist
COPY docs ./docs
RUN pip install --no-cache-dir -e . && mkdir -p /data

EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/status')" || exit 1
CMD ["saqr", "serve"]
