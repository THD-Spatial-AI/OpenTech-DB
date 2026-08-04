"""
main.py
=======
FastAPI application entry point for the OpenTech-db.

Run locally:
    uvicorn main:app --reload --port 8000

Interactive docs:
    http://127.0.0.1:8000/docs     (Swagger UI)
    http://127.0.0.1:8000/redoc    (ReDoc)
"""

from __future__ import annotations

from dotenv import load_dotenv
load_dotenv()  # load .env before any env-dependent imports

import json
import logging
import os
import uuid as _uuid
from pathlib import Path
from importlib.metadata import version, PackageNotFoundError

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from api.routes import router as tech_router, debug_router, ontology_router, admin_router, submissions_router
from api.auth import router as auth_router
from api.timeseries import router as timeseries_router, admin_ts_router
from api.scraper_routes import router as scraper_router
from adapters.pypsa_adapter import to_pypsa
from adapters.calliope_adapter import to_calliope
from schemas.models import (
    PowerPlant,
    EnergyStorage,
    ConversionTechnology,
    TransmissionLine,
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Version
# ---------------------------------------------------------------------------
try:
    _VERSION = version("techs_database")
except PackageNotFoundError:
    _VERSION = "0.1.0-dev"

# ---------------------------------------------------------------------------
# Lifespan: start/stop scrape scheduler
# ---------------------------------------------------------------------------

@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Start the scrape scheduler on startup; stop it on shutdown."""
    from scrapers.scheduler import start_scheduler, stop_scheduler
    start_scheduler()
    yield
    stop_scheduler()


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(lifespan=_lifespan,
    title="Energy Technology Database API",
    description=(
        "OEO-aligned repository of technical and economic parameters for "
        "energy generation, storage, transmission, and conversion technologies. "
        "Feeds Calliope, PyPSA, OSeMOSYS, and ADOPTNet0 modelling frameworks.\n\n"
        "**OEO reference**: https://openenergy-platform.org/ontology/oeo/"
    ),
    version=_VERSION,
    contact={
        "name":  "Deggendorf Institute of Technology (DIT)",
        "email": "ricardo.miranda-castillo@th-deg.de",
    },
    license_info={
        "name": "CC BY 4.0",
        "url":  "https://creativecommons.org/licenses/by/4.0/",
    },
    default_response_class=ORJSONResponse,
    openapi_tags=[
        {
            "name":        "Technologies",
            "description": "CRUD operations on the technology catalogue.",
        },
        {
            "name":        "Adapters",
            "description": "Translate a stored technology into framework-specific formats.",
        },
        {
            "name":        "Scraper",
            "description": (
                "Automated data-collection pipeline. Trigger runs, review candidates, "
                "and merge approved instances into the catalogue."
            ),
        },
        {
            "name":        "Admin",
            "description": "Catalogue management operations (admin-only).",
        },
        {
            "name":        "Auth",
            "description": "Authentication via ORCID OAuth and built-in admin credentials.",
        },
        {
            "name":        "Ontology",
            "description": "OEO-aligned controlled vocabularies for contributor submissions.",
        },
        {
            "name":        "TimeSeries",
            "description": "Generation and load profiles: upload, browse, and manage.",
        },
        {
            "name":        "Debug",
            "description": "Data-loading diagnostics and cache management (admin-only).",
        },
        {
            "name":        "System",
            "description": "Health checks and metadata.",
        },
    ],
)

# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    """Propagate or generate X-Request-ID for every response."""
    request_id = request.headers.get("X-Request-ID") or str(_uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


_CORS_ORIGINS = [
    "https://otdb.th-deg.de",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "http://localhost:4173",
]
_extra = os.getenv("CORS_ORIGINS", "")
if _extra:
    _CORS_ORIGINS += [o.strip() for o in _extra.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    # Authorization header must be explicitly exposed for GET /auth/me
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(tech_router,        prefix="/api/v1")
app.include_router(debug_router,       prefix="/api/v1")
app.include_router(auth_router,        prefix="/api/v1")
app.include_router(ontology_router,    prefix="/api/v1")
app.include_router(admin_router,       prefix="/api/v1")
app.include_router(submissions_router, prefix="/api/v1")
app.include_router(timeseries_router,  prefix="/api/v1")
app.include_router(admin_ts_router,    prefix="/api/v1")
app.include_router(scraper_router,     prefix="/api/v1")

# ---------------------------------------------------------------------------
# Static assets — project documentation (Markdown + LaTeX source)
# Accessible at:  http://localhost:8000/project-docs/content/01-introduction-goals.md
# ---------------------------------------------------------------------------
_DOCS_DIR = Path(__file__).parent / "documentation"
if _DOCS_DIR.exists():
    app.mount("/project-docs", StaticFiles(directory=str(_DOCS_DIR)), name="project-docs")

# ---------------------------------------------------------------------------
# Adapter endpoints
# ---------------------------------------------------------------------------
_DATA_DIR = Path(__file__).parent / "data"


def _load_tech_from_id(tech_id: str):
    """Find and load a technology JSON file by scanning the data directory."""
    from api.routes import _get_all
    techs = _get_all()
    tech = techs.get(tech_id)
    if tech is None:
        return None
    return tech


@app.get(
    "/api/v1/adapt/pypsa/{tech_id}",
    tags=["Adapters"],
    summary="Translate a technology to PyPSA parameters",
    deprecated=True,
    response_class=JSONResponse,
    description="Deprecated — use `GET /api/v1/technologies/{tech_id}/pypsa` instead.",
)
def adapt_pypsa(tech_id: str, instance_index: int = 0, discount_rate: float = 0.07):
    tech = _load_tech_from_id(tech_id)
    if tech is None:
        raise HTTPException(status_code=404, detail=f"Technology '{tech_id}' not found.")
    try:
        params = to_pypsa(tech, instance_index=instance_index, discount_rate=discount_rate)
        return JSONResponse({"technology": tech.name, "framework": "PyPSA", "parameters": params})
    except IndexError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get(
    "/api/v1/adapt/calliope/{tech_id}",
    tags=["Adapters"],
    summary="Translate a technology to Calliope parameters",
    deprecated=True,
    response_class=JSONResponse,
    description="Deprecated — use `GET /api/v1/technologies/{tech_id}/calliope` instead.",
)
def adapt_calliope(tech_id: str, instance_index: int = 0, cost_class: str = "monetary"):
    tech = _load_tech_from_id(tech_id)
    if tech is None:
        raise HTTPException(status_code=404, detail=f"Technology '{tech_id}' not found.")
    try:
        params = to_calliope(tech, instance_index=instance_index, cost_class=cost_class)
        return JSONResponse({"technology": tech.name, "framework": "Calliope", "parameters": params})
    except IndexError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# System endpoints
# ---------------------------------------------------------------------------

@app.get("/health", tags=["System"], summary="Health check")
def health_check():
    """Returns service status and version."""
    return {"status": "ok", "version": _VERSION}


@app.get("/", tags=["System"], include_in_schema=False)
def root():
    return {
        "message":    "Energy Technology Database API is running.",
        "docs":       "/docs",
        "redoc":      "/redoc",
        "api_prefix": "/api/v1",
    }


# ---------------------------------------------------------------------------
# Startup event – log catalogue size
# ---------------------------------------------------------------------------

@app.on_event("startup")
def on_startup():
    from api.routes import _get_all
    techs = _get_all()
    logger.info("Loaded %d technologies from /data.", len(techs))
    for tid, tech in techs.items():
        logger.info(
            "  [%s] %-40s | %-12s | %d instances",
            tid[:8],
            tech.name,
            tech.category.value,
            len(tech.instances),
        )
