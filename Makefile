SHELL := /bin/bash
COMPOSE := docker compose
WEB := $(COMPOSE) exec web

.PHONY: help env up down logs ps migrate migrate-new seed fixtures test test-web test-e2e test-e2e-update test-cv lint typecheck cv-run reset

help: ## List targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

env: ## Create .env from .env.example with fresh secrets
	@test -f .env && echo ".env already exists" || ( \
	  sed -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$$(openssl rand -base64 32)|" \
	      -e "s|^CV_CALLBACK_SECRET=.*|CV_CALLBACK_SECRET=$$(openssl rand -hex 32)|" \
	      -e "s|^ID_HASH_SECRET=.*|ID_HASH_SECRET=$$(openssl rand -hex 32)|" \
	      .env.example > .env && echo "Wrote .env" )

up: env ## Build and start the stack
	$(COMPOSE) up -d --build --renew-anon-volumes --wait --wait-timeout 600
	@echo "Open http://wideline.localhost"

down: ## Stop the stack (data is kept)
	$(COMPOSE) down

reset: ## Stop the stack and delete all data volumes
	$(COMPOSE) down -v

logs: ## Follow logs
	$(COMPOSE) logs -f --tail=100

ps:
	$(COMPOSE) ps

migrate: ## Apply migrations
	$(WEB) pnpm prisma migrate deploy

migrate-new: ## Create a migration from schema changes: make migrate-new name=add_x
	$(WEB) pnpm prisma migrate dev --name $(name)

seed: ## Seed the organisation, admin user, teams and a match
	$(WEB) pnpm prisma db seed

test: test-web test-cv ## Run all tests

fixtures: ## Generate the C06 test footage and the C07 HLS fixture (ffmpeg in the web container; kept if present)
	$(WEB) sh tests/fixtures/make-footage.sh
	$(WEB) pnpm tsx scripts/make-hls-fixture.ts

test-web: fixtures ## Web unit and integration tests (needs the stack running)
	$(WEB) pnpm test

# Playwright runs in its official image (same version as @playwright/test) on the
# compose network, so `make test-e2e` compares the same Linux PNG baselines as CI
# (ubuntu). Chromium always resolves *.localhost to loopback, so a small TCP relay
# inside the container forwards 127.0.0.1:80 to Caddy.
PLAYWRIGHT_IMAGE := mcr.microsoft.com/playwright:v1.64.1-noble
# Sign in as the seeded admin from .env unless E2E_EMAIL / E2E_PASSWORD are given.
E2E_EMAIL ?= $(shell sed -n 's/^SEED_ADMIN_EMAIL=//p' .env 2>/dev/null)
E2E_PASSWORD ?= $(shell sed -n 's/^SEED_ADMIN_PASSWORD=//p' .env 2>/dev/null)
# C07: the playback spec puts the HLS fixture in object storage with the keys from .env.
E2E_S3_ACCESS_KEY_ID ?= $(shell sed -n 's/^S3_ACCESS_KEY_ID=//p' .env 2>/dev/null)
E2E_S3_SECRET_ACCESS_KEY ?= $(shell sed -n 's/^S3_SECRET_ACCESS_KEY=//p' .env 2>/dev/null)
E2E_S3_BUCKET ?= $(shell sed -n 's/^S3_BUCKET=//p' .env 2>/dev/null)
export E2E_EMAIL E2E_PASSWORD E2E_S3_ACCESS_KEY_ID E2E_S3_SECRET_ACCESS_KEY E2E_S3_BUCKET
LOOPBACK_TO_CADDY := require("net").createServer(c=>{const s=require("net").connect(80,"caddy");c.on("error",()=>s.destroy());s.on("error",()=>c.destroy());c.pipe(s).pipe(c)}).listen(80,"127.0.0.1")
PLAYWRIGHT_RUN = docker run --rm --ipc=host --network wideline_default \
	  -v "$(CURDIR)/web:/work" -w /work \
	  -e CI= -e E2E_BASE_URL=http://wideline.localhost -e E2E_EMAIL -e E2E_PASSWORD -e E2E_DATABASE_URL \
	  -e E2E_S3_ACCESS_KEY_ID -e E2E_S3_SECRET_ACCESS_KEY -e E2E_S3_BUCKET \
	  $(PLAYWRIGHT_IMAGE) sh -c 'node -e '"'"'$(LOOPBACK_TO_CADDY)'"'"' & sleep 1; \
	    node node_modules/@playwright/test/cli.js test $(1) $(ARGS)'

test-e2e: fixtures ## Playwright against the running stack, in the Linux image (signs in with SEED_ADMIN_* from .env)
	$(call PLAYWRIGHT_RUN,)

test-e2e-update: fixtures ## Regenerate the Linux screenshot baselines
	$(call PLAYWRIGHT_RUN,--update-snapshots=all)

test-cv: ## CV worker tests
	cd cv_worker && uv run pytest

lint: ## Lint and typecheck everything
	$(WEB) pnpm lint
	$(WEB) pnpm typecheck
	cd cv_worker && uv run ruff check . && uv run ruff format --check . && uv run mypy wideline_cv

cv-run: ## Run the CV worker standalone: make cv-run video=match.mp4 calibration=cal.json out=./out
	cd cv_worker && uv run python -m wideline_cv run --video $(video) --calibration $(calibration) --out $(or $(out),./out)
