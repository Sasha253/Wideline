SHELL := /bin/bash
COMPOSE := docker compose
WEB := $(COMPOSE) exec web

.PHONY: help env up down logs ps migrate migrate-new seed test test-web test-e2e test-cv lint typecheck cv-run reset

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

test-e2e: ## Playwright smoke test against the running stack
	cd web && E2E_BASE_URL=http://wideline.localhost pnpm test:e2e

test-cv: ## CV worker tests
	cd cv_worker && uv run pytest

lint: ## Lint and typecheck everything
	$(WEB) pnpm lint
	$(WEB) pnpm typecheck
	cd cv_worker && uv run ruff check . && uv run ruff format --check . && uv run mypy wideline_cv

cv-run: ## Run the CV worker standalone: make cv-run video=match.mp4 calibration=cal.json out=./out
	cd cv_worker && uv run python -m wideline_cv run --video $(video) --calibration $(calibration) --out $(or $(out),./out)
