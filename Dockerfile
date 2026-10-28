# SAQR node: pipeline + API + dashboard. Based on the official Playwright image (Chromium preinstalled).
FROM mcr.microsoft.com/playwright/python:v1.63.0-noble

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    SAQR_HOST=0.0.0.0 SAQR_PORT=8000 SAQR_DATA_DIR=/data

WORKDIR /app
COPY pyproject.toml README.md ./
COPY saqr ./saqr
RUN pip install --no-cache-dir . && mkdir -p /data

COPY demo ./demo
COPY frontend/dist ./frontend/dist
COPY docs ./docs

EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/status')" || exit 1
CMD ["saqr", "serve"]
