"""
ccs-plant-sim  —  FastAPI OpenModelica Simulation Bridge
Schema version: 2.0
Port: 8766  (configurable via HOST / PORT env vars)

Carbon Capture and Storage (CCS) Power Plant Simulation
- CO2 source (flue gas from power plants, industrial processes)
- CO2 absorber (chemical absorption using solvents like MEA)
- CO2 stripper (solvent regeneration)
- CO2 compressor (multi-stage compression to 100+ bar)
- CO2 storage (geological formation monitoring)
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

# ──────────────────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
log = logging.getLogger("ccs-sim")

# ──────────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────────
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8766"))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELICA_DIR = os.path.join(BASE_DIR, "modelica")

# ──────────────────────────────────────────────────────────────────────────────
# OpenModelica engine singleton
# ──────────────────────────────────────────────────────────────────────────────
_omc = None
_omc_lock = threading.Lock()
_engine_ready = threading.Event()
_engine_error: Optional[str] = None
OPENMODELICA_AVAILABLE = False

try:
    from OMPython import OMCSessionZMQ
    OPENMODELICA_AVAILABLE = True
    log.info("OMPython package found — will use OpenModelica simulation engine.")
except ImportError:
    log.warning(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "  OpenModelica not available — running mock simulation engine\n"
        "  Install: pip install OMPython\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    )
    OMCSessionZMQ = None


_AUTO_START_ENGINE: bool = os.getenv("AUTO_START_ENGINE", "1").strip().lower() not in {"0", "false", "no"}


def _start_openmodelica_engine() -> None:
    """Background daemon thread: starts OpenModelica OMC session."""
    global _omc, _engine_error

    if not OPENMODELICA_AVAILABLE:
        log.info("Mock engine: marking engine_ready immediately.")
        _engine_ready.set()
        return

    try:
        log.info("Starting OpenModelica OMC session...")
        omc = OMCSessionZMQ()
        
        version = omc.sendExpression("getVersion()")
        log.info(f"OpenModelica version: {version}")
        
        # Load Modelica Standard Library (install if not found)
        try:
            loaded = omc.sendExpression('loadModel(Modelica)')
            if loaded:
                log.info("Modelica Standard Library loaded successfully")
        except Exception as load_err:
            log.info(f"Modelica Standard Library not found: {load_err}")
            log.info("Installing Modelica Standard Library (this may take 1-2 minutes)...")
            try:
                install_result = omc.sendExpression('installPackage(Modelica)')
                if install_result:
                    log.info("Modelica Standard Library installed successfully")
                    loaded = omc.sendExpression('loadModel(Modelica)')
                    if loaded:
                        log.info("Modelica Standard Library loaded after installation")
                else:
                    log.warning("installPackage returned False")
            except Exception as install_err:
                log.warning(f"Failed to install Modelica Standard Library: {install_err}")
        
        modelica_package = os.path.join(MODELICA_DIR, "CCSPlant.mo")
        if os.path.exists(modelica_package):
            result = omc.sendExpression(f'loadFile("{modelica_package}")')
            if result:
                log.info(f"Loaded CCSPlant library from {MODELICA_DIR}")
            else:
                log.warning("Failed to load CCSPlant library")
        
        with _omc_lock:
            _omc = omc
        
        log.info("OpenModelica engine ready.")
        _engine_ready.set()
        
    except Exception as exc:
        _engine_error = str(exc)
        log.error(f"OpenModelica engine failed to start: {exc}")
        _engine_ready.set()


# ──────────────────────────────────────────────────────────────────────────────
# In-memory job store
# ──────────────────────────────────────────────────────────────────────────────
class JobStatus(str, Enum):
    queued  = "queued"
    running = "running"
    done    = "done"
    error   = "error"


jobs: Dict[str, Dict[str, Any]] = {}
_ws_clients: Dict[str, List[WebSocket]] = {}
_ws_lock = asyncio.Lock()
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ccs-worker")

# ──────────────────────────────────────────────────────────────────────────────
# Pydantic models — schema v2.0
# ──────────────────────────────────────────────────────────────────────────────

class SimulationParams(BaseModel):
    t_end_s: float = Field(..., gt=0, description="Simulation horizon [s]")
    dt_s:    float = Field(..., gt=0, description="Time-step [s]")


class ProfilePoint(BaseModel):
    time_s:   float
    co2_tph:  float  # tonnes CO2 per hour


class SourceParams(BaseModel):
    tech_type:        Literal["coal_plant", "gas_plant", "cement", "steel", "refinery", "generic"]
    name:             Optional[str]   = None
    co2_concentration_pct: float     = Field(..., gt=0, le=100)
    flue_gas_flow_nm3h:    float     = Field(..., gt=0)
    temperature_c:     float          = Field(..., ge=0)
    pressure_bar:      float          = Field(..., gt=0)
    profile:           List[ProfilePoint]


class AbsorberParams(BaseModel):
    tech_type:            Literal["mea", "amine", "ammonia", "ionic_liquid"]
    name:                 Optional[str]  = None
    capture_efficiency_pct: float        = Field(..., gt=0, le=100)
    solvent_flow_rate_m3h:  float        = Field(..., gt=0)
    packing_height_m:      float         = Field(..., gt=0)
    column_diameter_m:     float         = Field(..., gt=0)
    operating_temperature_c: float       = Field(..., ge=0)
    operating_pressure_bar:  float       = Field(..., gt=0)


class StripperParams(BaseModel):
    tech_type:            Literal["thermal", "vacuum", "pressure_swing"]
    name:                 Optional[str]  = None
    regeneration_energy_kwh_tco2: float = Field(..., gt=0)
    steam_pressure_bar:   float          = Field(..., gt=0)
    operating_temperature_c: float       = Field(..., ge=0)
    co2_purity_pct:       float          = Field(..., gt=0, le=100)


class CompressorParams(BaseModel):
    tech_type:                  Literal["multistage", "isothermal", "integrally_geared"]
    name:                       Optional[str]  = None
    num_stages:                 int            = Field(..., gt=0, le=10)
    isentropic_efficiency_frac: float          = Field(..., gt=0, le=1)
    inlet_pressure_bar:         float          = Field(..., gt=0)
    target_pressure_bar:        float          = Field(..., gt=0)
    intercooler_efficiency_pct: float          = Field(..., ge=0, le=100)


class StorageParams(BaseModel):
    tech_type:                 Literal["depleted_field", "saline_aquifer", "ocean", "mineral"]
    name:                      Optional[str]  = None
    max_pressure_bar:          float          = Field(..., gt=0)
    min_pressure_bar:          float          = Field(..., ge=0)
    initial_fill_pct:          float          = Field(..., ge=0, le=100)
    capacity_tonnes:           float          = Field(..., gt=0)
    injection_rate_tph:        float          = Field(..., gt=0)
    permeability_md:           float          = Field(..., gt=0)
    porosity_pct:              float          = Field(..., gt=0, le=100)


class SimulationRequest(BaseModel):
    schema_version: Literal["2.0"]
    simulation:     SimulationParams
    source:         SourceParams
    absorber:       AbsorberParams
    stripper:       StripperParams
    compressor:     CompressorParams
    storage:        StorageParams


# ──────────────────────────────────────────────────────────────────────────────
# Mock simulation engine (numpy-based physics)
# ──────────────────────────────────────────────────────────────────────────────

def _run_mock_simulation(req: SimulationRequest) -> Dict[str, Any]:
    """
    CCS plant mock simulation with chemical engineering principles.
    Returns time-series for all components.
    """
    import numpy as np

    sim = req.simulation
    src = req.source
    absorber = req.absorber
    stripper = req.stripper
    cmp = req.compressor
    stg = req.storage

    # Time axis
    N    = math.floor(sim.t_end_s / sim.dt_s) + 1
    t    = np.array([i * sim.dt_s for i in range(N)], dtype=float)
    dt_h = sim.dt_s / 3600.0

    # Interpolate source CO2 emissions profile
    profile_t   = np.array([p.time_s  for p in src.profile], dtype=float)
    profile_co2 = np.array([p.co2_tph for p in src.profile], dtype=float)
    CO2_source  = np.interp(t, profile_t, profile_co2,
                            left=profile_co2[0], right=profile_co2[-1])

    # Constants
    CO2_MW_kg_kmol = 44.01         # kg/kmol
    R_gas = 8.314                   # J/(mol·K)
    T_amb = 293.0                   # K

    # Storage initialization
    m_co2_max = stg.capacity_tonnes * 1000.0  # kg
    m_co2 = (stg.initial_fill_pct / 100.0) * m_co2_max

    # Output arrays
    abs_co2_captured_tph    = np.zeros(N)
    abs_solvent_flow_m3h    = np.zeros(N)
    abs_power_kw            = np.zeros(N)
    abs_temperature_c       = np.zeros(N)

    str_co2_released_tph    = np.zeros(N)
    str_heat_demand_kw      = np.zeros(N)
    str_temperature_c       = np.zeros(N)

    cmp_power_kw            = np.zeros(N)
    cmp_outlet_pressure_bar = np.zeros(N)
    cmp_temperature_c       = np.zeros(N)

    stg_pressure_bar        = np.zeros(N)
    stg_fill_pct            = np.zeros(N)
    stg_co2_mass_tonnes     = np.zeros(N)
    stg_injection_rate_tph  = np.zeros(N)

    # Simulation loop
    for i in range(N):
        # Storage snapshot
        p_bar = float(np.clip(
            stg.min_pressure_bar + (m_co2 / m_co2_max) * 
            (stg.max_pressure_bar - stg.min_pressure_bar),
            stg.min_pressure_bar, stg.max_pressure_bar
        ))
        fill = float(np.clip(m_co2 / m_co2_max * 100.0, 0.0, 100.0))
        
        stg_pressure_bar[i] = p_bar
        stg_fill_pct[i] = fill
        stg_co2_mass_tonnes[i] = m_co2 / 1000.0

        # Absorber: capture CO2 from flue gas
        co2_available_tph = float(CO2_source[i])
        capture_rate = absorber.capture_efficiency_pct / 100.0
        co2_captured_tph = co2_available_tph * capture_rate
        
        # Absorber power (pumps, fans)
        abs_power = co2_captured_tph * 15.0  # kW per tonne/h (typical)
        
        abs_co2_captured_tph[i] = co2_captured_tph
        abs_solvent_flow_m3h[i] = absorber.solvent_flow_rate_m3h
        abs_power_kw[i] = abs_power
        abs_temperature_c[i] = absorber.operating_temperature_c

        # Stripper: regenerate solvent and release pure CO2
        co2_to_strip_tph = co2_captured_tph
        strip_heat = co2_to_strip_tph * stripper.regeneration_energy_kwh_tco2 / 1000.0  # kW
        purity_factor = stripper.co2_purity_pct / 100.0
        co2_released_tph = co2_to_strip_tph * purity_factor
        
        str_co2_released_tph[i] = co2_released_tph
        str_heat_demand_kw[i] = strip_heat
        str_temperature_c[i] = stripper.operating_temperature_c

        # Compressor: compress CO2 to pipeline/storage pressure
        if co2_released_tph > 0:
            m_dot_co2_kgs = co2_released_tph * 1000.0 / 3600.0  # kg/s
            p_ratio = cmp.target_pressure_bar / max(cmp.inlet_pressure_bar, 1.0)
            n_poly = 1.3
            
            # Multi-stage compression
            p_ratio_per_stage = p_ratio ** (1.0 / cmp.num_stages)
            W_stage_kw = (m_dot_co2_kgs * R_gas * T_amb / (CO2_MW_kg_kmol / 1000.0)
                         * n_poly / (n_poly - 1.0)
                         * (p_ratio_per_stage ** ((n_poly - 1.0) / n_poly) - 1.0)) / 1000.0
            
            W_total_kw = W_stage_kw * cmp.num_stages / cmp.isentropic_efficiency_frac
            
            p_out = min(cmp.target_pressure_bar, 
                       cmp.inlet_pressure_bar * (1 + 0.1 * cmp.num_stages))
            
            # Temperature rise due to compression
            T_rise = 30.0 * cmp.num_stages * (1 - cmp.intercooler_efficiency_pct / 100.0)
        else:
            W_total_kw = 0.0
            p_out = cmp.inlet_pressure_bar
            T_rise = 0.0
        
        cmp_power_kw[i] = W_total_kw
        cmp_outlet_pressure_bar[i] = p_out
        cmp_temperature_c[i] = T_amb - 273.15 + T_rise

        # Storage: inject compressed CO2
        injection_rate = min(co2_released_tph, stg.injection_rate_tph)
        if p_bar < stg.max_pressure_bar:
            m_co2 += injection_rate * 1000.0 * dt_h  # kg
            m_co2 = min(m_co2, m_co2_max)
        
        stg_injection_rate_tph[i] = injection_rate

    # KPI aggregates
    total_co2_captured_tonnes   = float(np.sum(abs_co2_captured_tph) * dt_h)
    total_co2_stored_tonnes     = float(m_co2 / 1000.0 - stg.initial_fill_pct / 100.0 * stg.capacity_tonnes)
    total_abs_energy_kwh        = float(np.sum(abs_power_kw) * dt_h)
    total_str_energy_kwh        = float(np.sum(str_heat_demand_kw) * dt_h)
    total_cmp_energy_kwh        = float(np.sum(cmp_power_kw) * dt_h)
    total_energy_kwh            = total_abs_energy_kwh + total_str_energy_kwh + total_cmp_energy_kwh
    
    specific_energy_kwh_tco2    = total_energy_kwh / max(total_co2_captured_tonnes, 1e-9)
    capture_rate_avg_pct        = float(np.mean(abs_co2_captured_tph / np.maximum(CO2_source, 1e-9)) * 100.0)
    
    # Build response
    result = {
        "job_id": str(uuid.uuid4()),
        "status": "done",
        "simulation_time_s": sim.t_end_s,
        "timestep_s": sim.dt_s,
        
        # Time series
        "time_s": t.tolist(),
        
        # Source
        "source_co2_tph": CO2_source.tolist(),
        
        # Absorber
        "absorber_co2_captured_tph": abs_co2_captured_tph.tolist(),
        "absorber_solvent_flow_m3h": abs_solvent_flow_m3h.tolist(),
        "absorber_power_kw": abs_power_kw.tolist(),
        "absorber_temperature_c": abs_temperature_c.tolist(),
        
        # Stripper
        "stripper_co2_released_tph": str_co2_released_tph.tolist(),
        "stripper_heat_demand_kw": str_heat_demand_kw.tolist(),
        "stripper_temperature_c": str_temperature_c.tolist(),
        
        # Compressor
        "compressor_power_kw": cmp_power_kw.tolist(),
        "compressor_outlet_pressure_bar": cmp_outlet_pressure_bar.tolist(),
        "compressor_temperature_c": cmp_temperature_c.tolist(),
        
        # Storage
        "storage_pressure_bar": stg_pressure_bar.tolist(),
        "storage_fill_pct": stg_fill_pct.tolist(),
        "storage_co2_mass_tonnes": stg_co2_mass_tonnes.tolist(),
        "storage_injection_rate_tph": stg_injection_rate_tph.tolist(),
        
        # KPIs
        "kpi": {
            "total_co2_captured_tonnes": total_co2_captured_tonnes,
            "total_co2_stored_tonnes": total_co2_stored_tonnes,
            "total_absorber_energy_kwh": total_abs_energy_kwh,
            "total_stripper_energy_kwh": total_str_energy_kwh,
            "total_compressor_energy_kwh": total_cmp_energy_kwh,
            "total_energy_kwh": total_energy_kwh,
            "specific_energy_kwh_tco2": specific_energy_kwh_tco2,
            "average_capture_rate_pct": capture_rate_avg_pct,
        },
        
        "schema_version": "2.0",
    }
    
    return result


# ──────────────────────────────────────────────────────────────────────────────
# FastAPI lifecycle
# ──────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown logic - start OpenModelica engine in background."""
    if _AUTO_START_ENGINE:
        log.info("Starting OpenModelica engine in background thread...")
        threading.Thread(target=_start_openmodelica_engine, daemon=True, name="omc-init").start()
    else:
        log.warning("AUTO_START_ENGINE=0 — engine will NOT start automatically.")
        _engine_ready.set()
    
    yield
    
    log.info("Shutting down CCS simulation service...")
    if _omc is not None:
        try:
            _omc.sendExpression("quit()")
        except:
            pass


app = FastAPI(
    title="CCS Plant Simulation Service",
    description="OpenModelica-based Carbon Capture and Storage simulation bridge",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────────────────────
# API Endpoints
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    """Health check - returns engine status."""
    is_ready = _engine_ready.is_set() and (_omc is not None or not OPENMODELICA_AVAILABLE)
    
    error_msg = None
    if not is_ready:
        if _engine_error:
            error_msg = _engine_error
        else:
            error_msg = "Engine is initializing..."
    elif OPENMODELICA_AVAILABLE and _omc is None:
        error_msg = _engine_error or "OpenModelica failed to start"
    # NOTE: not OPENMODELICA_AVAILABLE is NOT an error — CCS runs an analytical
    # (numpy) engine by design (see _run_simulation_job → _run_mock_simulation),
    # and ships no Modelica model. Reporting a missing-omc "error" here misled
    # the UI into showing a fault when the service is fully operational.

    return {
        "engine_ready": is_ready and _omc is not None if OPENMODELICA_AVAILABLE else is_ready,
        "engine_error": error_msg,
        "engine": "openmodelica" if (OPENMODELICA_AVAILABLE and _omc is not None) else "analytical",
        "active_jobs": sum(1 for j in jobs.values() if j["status"] in ("queued", "running")),
    }


@app.post("/api/ccs/submit")
async def submit_simulation(req: SimulationRequest):
    """Submit a CCS simulation job."""
    job_id = str(uuid.uuid4())
    
    jobs[job_id] = {
        "job_id": job_id,
        "status": JobStatus.queued,
        "request": req.dict(),
        "result": None,
        "error": None,
        "submitted_at": time.time(),
    }
    
    # Run simulation in background
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, _run_simulation_job, job_id)
    
    return {"job_id": job_id, "status": "queued"}


def _run_simulation_job(job_id: str):
    """Execute simulation in thread pool."""
    try:
        jobs[job_id]["status"] = JobStatus.running
        req = SimulationRequest(**jobs[job_id]["request"])
        
        log.info(f"[{job_id[:8]}] Running CCS simulation...")
        result = _run_mock_simulation(req)
        
        jobs[job_id]["result"] = result
        jobs[job_id]["status"] = JobStatus.done
        log.info(f"[{job_id[:8]}] Simulation complete")
        
    except Exception as exc:
        log.error(f"[{job_id[:8]}] Simulation failed: {exc}")
        jobs[job_id]["error"] = str(exc)
        jobs[job_id]["status"] = JobStatus.error


@app.get("/api/ccs/status/{job_id}")
async def get_status(job_id: str):
    """Poll job status."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    return {
        "job_id": job_id,
        "status": job["status"],
        "result": job["result"],
        "error": job["error"],
    }


@app.get("/")
async def root():
    """Root endpoint - service info."""
    return {
        "service": "CCS Plant Simulation",
        "version": "2.0.0",
        "engine": "OpenModelica" if OPENMODELICA_AVAILABLE else "Mock",
        "endpoints": ["/api/health", "/api/ccs/submit", "/api/ccs/status/{job_id}"],
    }


# ──────────────────────────────────────────────────────────────────────────────
# Main entry point
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    log.info(f"Starting CCS simulation service on {HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
