# CV worker. Started per job by the dispatcher (CV-01): runs the pipeline on
# one match, writes result.json and debug chunks to presigned URLs, calls back,
# and exits. CPU in V0; the same image later runs on a rented GPU.
FROM python:3.12-slim-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -r -u 10001 worker

COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv UV_NO_CACHE=1 PATH=/opt/venv/bin:$PATH
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY wideline_cv ./wideline_cv
RUN uv sync --frozen --no-dev

USER worker
ENTRYPOINT ["python", "-m", "wideline_cv"]
