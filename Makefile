# ── opentech-db — local development setup ────────────────────────────────────
# Prerequisites: Python 3.11+, Node.js 18+, Docker Desktop
#
# Quick start:
#
#   make install          ← first time only: dependencies + services + secrets
#   make start            ← every subsequent time: services + dev servers
#
# On Windows run from PowerShell or Command Prompt.
# 'make dev' (combined server) requires Git Bash; use separate terminals otherwise.
# ─────────────────────────────────────────────────────────────────────────────

.PHONY: help install configure start supabase auth auth-down auth-logs backend frontend stop reset lint build dev

# ── Platform ─────────────────────────────────────────────────────────────────

ifeq ($(OS),Windows_NT)
    PYTHON      := python
    VENV_BIN    := .venv/Scripts
    DEV_NULL    := NUL
else
    PYTHON      := python3
    VENV_BIN    := .venv/bin
    DEV_NULL    := /dev/null
endif

PY  := $(VENV_BIN)/python
PIP := $(VENV_BIN)/pip
UV  := $(VENV_BIN)/uvicorn

# ── Default ───────────────────────────────────────────────────────────────────

help:
	@echo.
	@echo   opentech-db make targets
	@echo.
	@echo   make install     one-time setup: venv, npm, services, secrets
	@echo   make start       start all services then open both dev servers
	@echo   make configure   regenerate local secrets
	@echo   make auth        start or rebuild Keycloak/Go-auth/Redis/Postgres
	@echo   make auth-down   stop the auth stack
	@echo   make auth-logs   follow Keycloak and Go auth logs
	@echo   make backend     start FastAPI on :8000
	@echo   make frontend    start Vite on :5173
	@echo   make dev         start both servers in one terminal (Git Bash only)
	@echo   make supabase    start local Supabase data services
	@echo   make stop        stop Supabase containers
	@echo   make reset       wipe local DB and re-run migrations
	@echo   make lint        ESLint on the frontend
	@echo   make build       production frontend bundle
	@echo.

# ── One-time setup ───────────────────────────────────────────────────────────

install: _check-docker _create-envs .venv frontend/node_modules _install-supabase-cli
	$(MAKE) --no-print-directory supabase
	$(MAKE) --no-print-directory auth
	@echo.
	@echo ================================================================
	@echo   Setup complete. Data and auth containers are running.
	@echo   Start the dev servers in two terminals:
	@echo     Terminal 1:  make backend
	@echo     Terminal 2:  make frontend
	@echo ================================================================
	@echo.

# Day-to-day: ensure all services are up, then open dev servers.
start: _check-docker configure
	@echo Starting data services...
	@supabase start >$(DEV_NULL) 2>&1 || echo Supabase already running.
	$(MAKE) --no-print-directory auth
	@echo.
	@echo Services are up. Start dev servers:
	@echo   Terminal 1: make backend
	@echo   Terminal 2: make frontend
	@echo.

# Generates independent local secrets and synchronizes AUTH_INTERNAL_SECRET.
configure: .venv
	$(PY) tools/configure_env.py

# ── Prerequisites ─────────────────────────────────────────────────────────────

_check-docker:
	@docker info >$(DEV_NULL) 2>&1 || (echo. && echo ERROR: Docker Desktop is not running. Please start it and try again. && exit 1)

# Use Python (always available as a prerequisite) for cross-platform file copy.
_create-envs:
	@$(PYTHON) -c "import shutil, pathlib; pathlib.Path('.env').exists() or shutil.copy('.env.example', '.env')" && echo Created .env if missing.
	@$(PYTHON) -c "import shutil, pathlib; pathlib.Path('frontend/.env.local').exists() or shutil.copy('frontend/.env.example', 'frontend/.env.local')" && echo Created frontend/.env.local if missing.

_install-supabase-cli:
	@supabase --version >$(DEV_NULL) 2>&1 || (echo Installing Supabase CLI... && npm install -g supabase)

# Python virtualenv — only created when the directory does not exist.
.venv:
	$(PYTHON) -m venv .venv
	$(PIP) install --upgrade pip --quiet
	$(PIP) install -r requirements.txt

# npm deps — only runs when package.json is newer than node_modules.
frontend/node_modules: frontend/package.json
	cd frontend && npm install

# ── Supabase data services (GoTrue/Auth is disabled) ─────────────────────────

supabase: _check-docker _install-supabase-cli .venv
	supabase start
	supabase migration up --local
	@echo Patching .env files with local Supabase credentials...
	$(PY) tools/patch_supabase_env.py

stop:
	supabase stop

reset: _check-docker
	supabase db reset

# ── Authentication stack ──────────────────────────────────────────────────────

auth: _check-docker configure
	docker compose --env-file keycloak/.env.local -f keycloak/compose.local.yml up -d --build

auth-down:
	docker compose --env-file keycloak/.env.local -f keycloak/compose.local.yml down

auth-logs:
	docker compose --env-file keycloak/.env.local -f keycloak/compose.local.yml logs -f keycloak auth-service

# ── Dev servers ───────────────────────────────────────────────────────────────

backend:
	$(UV) main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

# Combined launcher — requires bash (Git Bash on Windows).
# Ctrl+C stops both servers.
dev:
	@trap 'kill %1 2>/dev/null; exit 0' INT TERM EXIT; \
	 $(UV) main:app --reload --port 8000 & \
	 cd frontend && npm run dev

# ── Code quality ──────────────────────────────────────────────────────────────

lint:
	cd frontend && npm run lint

build:
	cd frontend && npm run build
