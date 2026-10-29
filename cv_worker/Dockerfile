# CV worker. Started per job by the dispatcher (CV-01): runs the pipeline on
# one match, writes result.json and a calibration still to presigned URLs,
# calls back, and exits.
#
# Two targets (C09):
# - `gpu`: CUDA runtime, the `model` extra (torch, torchvision, rfdetr) and the
#   pinned RF-DETR checkpoint, downloaded and checked by sha256 at build time,
#   WIDELINE_CV_MODE=model. Built by hand only (`make cv-image-gpu`): its
#   runtime licences wait on B-001, and CI never builds or scans it.
# - `cpu` (last, so the default build): the slim image the docker provider and
#   CI use. No model extra, so it runs synthetic mode (Apache, MIT and BSD
#   packages only).

FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04 AS gpu

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3.12 ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -r -u 10001 worker

COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv UV_NO_CACHE=1 \
    UV_PYTHON=/usr/bin/python3.12 PATH=/opt/venv/bin:$PATH
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --extra model --no-install-project

# The pinned checkpoint (wideline_cv/detect/rfdetr_detector.py ALLOWED_CHECKPOINTS).
ARG RFDETR_WEIGHTS_URL=https://storage.googleapis.com/rfdetr/medium_coco/checkpoint_best_regular.pth
ARG RFDETR_WEIGHTS_SHA256=749ff6071828aaffac63e204c4f4135ed3d6cdae4d702e086c360edc3b5768c8
RUN mkdir -p /opt/weights \
 && curl -fsSL -o /opt/weights/rfdetr.pth "$RFDETR_WEIGHTS_URL" \
 && echo "$RFDETR_WEIGHTS_SHA256  /opt/weights/rfdetr.pth" | sha256sum -c -

COPY wideline_cv ./wideline_cv
RUN uv sync --frozen --no-dev --extra model

ENV WIDELINE_CV_MODE=model WIDELINE_CV_MODEL_SIZE=medium WIDELINE_CV_WEIGHTS=/opt/weights/rfdetr.pth
USER worker
ENTRYPOINT ["python", "-m", "wideline_cv"]

FROM python:3.12-slim-bookworm AS cpu

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

ENV WIDELINE_CV_MODE=synthetic
USER worker
ENTRYPOINT ["python", "-m", "wideline_cv"]
