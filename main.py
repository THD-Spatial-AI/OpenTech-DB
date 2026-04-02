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

import json
import logging
from pathlib import Path
from importlib.metadata import version, PackageNotFoundError

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from api.routes import router as tech_router, debug_router, ontology_router
from api.auth import router as auth_router
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
# App factory
# ---------------------------------------------------------------------------
app = FastAPI(
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
            "name":        "System",
            "description": "Health checks and metadata.",
        },
    ],
)

# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    # In development: allow the Vite dev server (port 5173 or 5174)
    # and the ngrok tunnel that exposes this FastAPI backend.
    # In production: replace with your actual deployed frontend origin.
    allow_origins=[
        "http://localhost:5173",    # Vite default
        "http://localhost:5174",    # Vite fallback
        "http://localhost:5175",    # Vite fallback (further)
        "http://localhost:4173",    # Vite `npm run preview`
        # Add your deployed frontend URL here when going to production:
        # "https://your-frontend.example.com",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    # Authorization header must be explicitly exposed for GET /auth/me
    allow_headers=["Authorization", "Content-Type", "ngrok-skip-browser-warning", "Accept"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(tech_router,      prefix="/api/v1")
app.include_router(debug_router,     prefix="/api/v1")
app.include_router(auth_router,      prefix="/api/v1")
app.include_router(ontology_router,  prefix="/api/v1")

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
    response_class=JSONResponse,
)
def adapt_pypsa(tech_id: str, instance_index: int = 0, discount_rate: float = 0.07):
    """
    Return a PyPSA-ready parameter dictionary for a stored technology.

    - **tech_id**: UUID of the technology record.
    - **instance_index**: which EquipmentInstance to translate (0-based).
    - **discount_rate**: annual discount rate for annualised capex calculation.
    """
    tech = _load_tech_from_id(tech_id)
    if tech is None:
        return JSONResponse({"detail": f"Technology '{tech_id}' not found."}, status_code=404)
    try:
        params = to_pypsa(tech, instance_index=instance_index, discount_rate=discount_rate)
        return JSONResponse({"technology": tech.name, "framework": "PyPSA", "parameters": params})
    except IndexError as e:
        return JSONResponse({"detail": str(e)}, status_code=400)


@app.get(
    "/api/v1/adapt/calliope/{tech_id}",
    tags=["Adapters"],
    summary="Translate a technology to Calliope parameters",
    response_class=JSONResponse,
)
def adapt_calliope(tech_id: str, instance_index: int = 0, cost_class: str = "monetary"):
    """
    Return a Calliope-ready technology configuration dict for a stored technology.

    - **tech_id**: UUID of the technology record.
    - **instance_index**: which EquipmentInstance to translate (0-based).
    - **cost_class**: Calliope cost class key (default: ``monetary``).
    """
    tech = _load_tech_from_id(tech_id)
    if tech is None:
        return JSONResponse({"detail": f"Technology '{tech_id}' not found."}, status_code=404)
    try:
        params = to_calliope(tech, instance_index=instance_index, cost_class=cost_class)
        return JSONResponse({"technology": tech.name, "framework": "Calliope", "parameters": params})
    except IndexError as e:
        return JSONResponse({"detail": str(e)}, status_code=400)


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
