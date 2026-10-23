SHELL := /bin/bash
COMPOSE := docker compose
WEB := $(COMPOSE) exec web

.PHONY: help env up down logs ps migrate migrate-new seed test test-web test-e2e test-e2e-update test-cv lint typecheck cv-run reset

help: ## List targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

env: ## Create .env from .env.example with fresh secrets
	@test -f .env && echo ".env already exists" || ( \
	  sed -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$$(openssl rand -base64 32)|" \
	      -e "s|^CV_CALLBACK_SECRET=.*|CV_CALLBACK_SECRET=$$(openssl rand -hex 32)|" \
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

test-web: ## Web unit and integration tests (needs the stack running)
	$(WEB) pnpm test

# Playwright runs in its official image (same version as @playwright/test) on the
# compose network, so `make test-e2e` compares the same Linux PNG baselines as CI
# (ubuntu). Chromium always resolves *.localhost to loopback, so a small TCP relay
# inside the container forwards 127.0.0.1:80 to Caddy.
PLAYWRIGHT_IMAGE := mcr.microsoft.com/playwright:v1.64.1-noble
LOOPBACK_TO_CADDY := require("net").createServer(c=>{const s=require("net").connect(80,"caddy");c.on("error",()=>s.destroy());s.on("error",()=>c.destroy());c.pipe(s).pipe(c)}).listen(80,"127.0.0.1")
PLAYWRIGHT_RUN = docker run --rm --ipc=host --network wideline_default \
	  -v "$(CURDIR)/web:/work" -w /work \
	  -e CI= -e E2E_BASE_URL=http://wideline.localhost -e E2E_PASSWORD -e E2E_DATABASE_URL \
	  $(PLAYWRIGHT_IMAGE) sh -c 'node -e '"'"'$(LOOPBACK_TO_CADDY)'"'"' & sleep 1; \
	    node node_modules/@playwright/test/cli.js test $(1) $(ARGS)'

test-e2e: ## Playwright against the running stack, in the Linux image: make test-e2e E2E_PASSWORD=…
	$(call PLAYWRIGHT_RUN,)

test-e2e-update: ## Regenerate the Linux screenshot baselines: make test-e2e-update E2E_PASSWORD=…
	$(call PLAYWRIGHT_RUN,--update-snapshots=all)

test-cv: ## CV worker tests
	cd cv_worker && uv run pytest

lint: ## Lint and typecheck everything
	$(WEB) pnpm lint
	$(WEB) pnpm typecheck
	cd cv_worker && uv run ruff check . && uv run ruff format --check . && uv run mypy wideline_cv

cv-run: ## Run the CV worker standalone: make cv-run video=match.mp4 calibration=cal.json out=./out
	cd cv_worker && uv run python -m wideline_cv run --video $(video) --calibration $(calibration) --out $(or $(out),./out)
