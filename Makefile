# ── opentech-db — local development setup ────────────────────────────────────
# Prerequisites: Python 3.11+, Node.js 18+, Docker Desktop
#
# Quick start (Mac / Linux / Git Bash on Windows):
#
#   make install          ← dependencies + Supabase + complete auth stack
#   make backend          ← terminal 1
#   make frontend         ← terminal 2
#
# ─────────────────────────────────────────────────────────────────────────────

.PHONY: help install configure supabase auth auth-down auth-logs backend frontend stop reset lint build dev

# ── Platform ─────────────────────────────────────────────────────────────────

ifeq ($(OS),Windows_NT)
    PYTHON   := python
    VENV_BIN := .venv/Scripts
else
    PYTHON   := python3
    VENV_BIN := .venv/bin
endif

PY  := $(VENV_BIN)/python
PIP := $(VENV_BIN)/pip
UV  := $(VENV_BIN)/uvicorn

# ── Default ───────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  opentech-db — make targets"
	@echo ""
	@echo "  make install     one-time setup: venv · npm · data services · Keycloak/auth · .env"
	@echo "  make configure   generate matching backend/auth-service secrets"
	@echo "  make auth        start local Keycloak, Go auth, Postgres, and Redis"
	@echo "  make auth-down   stop the local authentication stack"
	@echo "  make auth-logs   follow Keycloak and Go auth logs"
	@echo "  make backend     start FastAPI on :8000"
	@echo "  make frontend    start Vite dev server on :5173"
	@echo "  make dev         start both in one terminal (Ctrl+C to stop all)"
	@echo "  make supabase    start local Supabase data services (Auth disabled)"
	@echo "  make stop        stop local Supabase data containers"
	@echo "  make reset       wipe local data DB and re-run migrations"
	@echo "  make lint        ESLint on the frontend"
	@echo "  make build       production frontend bundle"
	@echo ""

# ── One-time setup ───────────────────────────────────────────────────────────

install: _check-docker .venv frontend/node_modules .env frontend/.env.local _install-supabase-cli
	@$(MAKE) --no-print-directory supabase
	@$(MAKE) --no-print-directory auth
	@echo ""
	@echo "================================================================"
	@echo "  Setup complete! Data and authentication containers are running."
	@echo "  Start the dev servers:"
	@echo "    Terminal 1:  make backend"
	@echo "    Terminal 2:  make frontend"
	@echo "================================================================"
	@echo ""

# Generates independent local secrets and synchronizes AUTH_INTERNAL_SECRET.
configure: .venv
	@$(PY) tools/configure_env.py

_check-docker:
	@docker info > /dev/null 2>&1 \
	  || (echo "" && echo "ERROR: Docker Desktop is not running. Please start it and try again." && exit 1)

_install-supabase-cli:
	@which supabase > /dev/null 2>&1 \
	  || (echo "Installing Supabase CLI..." && npm install -g supabase)

# Python virtualenv — only created when the directory doesn't exist
.venv:
	$(PYTHON) -m venv .venv
	$(PIP) install --upgrade pip --quiet
	$(PIP) install -r requirements.txt

# npm deps — only runs when package.json is newer than node_modules
frontend/node_modules: frontend/package.json
	cd frontend && npm install

# .env template — only created when file is missing
.env:
	@cp .env.example .env
	@echo "Created .env from .env.example — run make configure."

frontend/.env.local:
	@cp frontend/.env.example frontend/.env.local
	@echo "Created frontend/.env.local from template."

# ── Supabase data services (authentication is disabled) ──────────────────────

supabase: _check-docker _install-supabase-cli .venv
	supabase start
	supabase migration up --local
	@echo "Patching .env files with local credentials..."
	@$(PY) tools/patch_supabase_env.py

stop:
	supabase stop

reset: _check-docker
	supabase db reset

# ── Authentication stack ─────────────────────────────────────────────────────

auth: _check-docker configure
	docker compose --env-file keycloak/.env.local -f keycloak/compose.local.yml up -d --build

auth-down:
	docker compose --env-file keycloak/.env.local -f keycloak/compose.local.yml down

auth-logs:
	docker compose --env-file keycloak/.env.local -f keycloak/compose.local.yml logs -f keycloak auth-service

# ── Dev servers ──────────────────────────────────────────────────────────────

backend:
	$(UV) main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

# Runs backend in the background and frontend in the foreground.
# Ctrl+C stops the frontend; the backend is also killed on exit.
dev:
	@trap 'kill %1 2>/dev/null; exit 0' INT TERM EXIT; \
	 $(UV) main:app --reload --port 8000 & \
	 cd frontend && npm run dev

# ── Code quality ─────────────────────────────────────────────────────────────

lint:
	cd frontend && npm run lint

build:
	cd frontend && npm run build
