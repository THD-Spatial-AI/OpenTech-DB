

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
import tempfile
import shutil

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
log = logging.getLogger("hydrogen-sim")

# ──────────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────────
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8765"))
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
        
        # Test connection
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
        
        # Load H2PowerPlant library package and validate model availability
        modelica_package = os.path.join(MODELICA_DIR, "H2PowerPlant", "package.mo")
        if os.path.exists(modelica_package):
            result = omc.sendExpression(f'loadFile("{modelica_package}")')
            if result:
                check = omc.sendExpression('checkModel(H2PowerPlant.CompleteSystem)')
                if check:
                    log.info(f"Loaded H2PowerPlant library from {MODELICA_DIR}")
                else:
                    err = omc.sendExpression('getErrorString()')
                    raise RuntimeError(f"H2PowerPlant.CompleteSystem failed checkModel: {err}")
            else:
                err = omc.sendExpression('getErrorString()')
                raise RuntimeError(f"Failed to load H2PowerPlant package.mo: {err}")
        
        with _omc_lock:
            _omc = omc
        
        log.info("OpenModelica engine ready.")
        _engine_ready.set()
        
    except Exception as exc:
        _engine_error = str(exc)
        log.error(f"OpenModelica engine failed to start: {exc}")
        _engine_ready.set()  # unblock health checks even on failure


def _collect_omc_diagnostics(omc: Any, model_name: str) -> Dict[str, Any]:
    """Collect best-effort diagnostics from OMC for troubleshooting."""
    diag: Dict[str, Any] = {}
    try:
        diag["version"] = omc.sendExpression("getVersion()")
    except Exception:
        diag["version"] = None
    try:
        diag["class_exists"] = omc.sendExpression(f"existClass({model_name})")
    except Exception:
        diag["class_exists"] = None
    try:
        diag["check_model"] = omc.sendExpression(f"checkModel({model_name})")
    except Exception:
        diag["check_model"] = None
    try:
        diag["error_string"] = omc.sendExpression("getErrorString()")
    except Exception:
        diag["error_string"] = None
    return diag


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
_ws_lock = asyncio.Lock()          # used only in async context
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="sim-worker")

# ──────────────────────────────────────────────────────────────────────────────
# Pydantic models — schema v2.0
# (See API contract §2 / §9)
# ──────────────────────────────────────────────────────────────────────────────

class SimulationParams(BaseModel):
    t_end_s: float = Field(..., gt=0,  description="Simulation horizon [s]")
    dt_s:    float = Field(..., gt=0,  description="Time-step [s]")


class ProfilePoint(BaseModel):
    time_s:   float
    power_kw: float


class SourceParams(BaseModel):
    tech_type:      Literal["solar", "wind", "nuclear", "hydro", "gas",
                             "coal", "biomass", "geothermal", "generic"]
    name:           Optional[str]   = None
    capacity_kw:    Optional[float] = Field(None, ge=0)
    efficiency_pct: Optional[float] = Field(None, ge=0, le=100)
    profile:        List[ProfilePoint]


class ElectrolyzerParams(BaseModel):
    tech_type:                  Literal["pem", "alkaline", "soec", "aem"]
    name:                       Optional[str]  = None
    capacity_kw:                float          = Field(..., gt=0)
    nominal_efficiency_pct_hhv: float          = Field(..., gt=0, le=100)
    min_load_pct:               float          = Field(..., ge=0, le=100)
    max_load_pct:               float          = Field(100.0, ge=0, le=100)
    operating_temperature_c:    float          = Field(..., ge=0)
    water_flow_rate_lpm:        float          = Field(..., ge=0)
    h2_hhv_kwh_per_kg:          float          = Field(39.4)


class CompressorParams(BaseModel):
    tech_type:                  Literal["reciprocating", "ionic", "linear"]
    name:                       Optional[str]  = None
    isentropic_efficiency_frac: float          = Field(..., gt=0, le=1)
    inlet_pressure_bar:         float          = Field(..., gt=0)
    target_pressure_bar:        float          = Field(..., gt=0)


class StorageParams(BaseModel):
    tech_type:                 Literal["compressed_h2", "liquid_h2", "metal_hydride", "cavern"]
    name:                      Optional[str]  = None
    max_pressure_bar:          float          = Field(..., gt=0)
    min_pressure_bar:          float          = Field(..., ge=0)
    initial_soc_pct:           float          = Field(..., ge=0, le=100)
    round_trip_efficiency_pct: float          = Field(..., gt=0, le=100)


class FuelCellParams(BaseModel):
    tech_type:              Literal["pem", "sofc", "mcfc", "pafc", "alkaline"]
    name:                   Optional[str]   = None
    rated_power_kw:         Optional[float] = Field(None, ge=0)
    nominal_efficiency_pct: float           = Field(..., gt=0, le=100)
    min_load_pct:           float           = Field(..., ge=0, le=100)
    h2_flow_rate_nm3h:      float           = Field(..., ge=0)
    operating_pressure_bar: float           = Field(..., ge=0)
    cooling_capacity_kw:    float           = Field(..., ge=0)


class SimulationRequest(BaseModel):
    schema_version: Literal["2.0"]
    simulation:     SimulationParams
    source:         SourceParams
    electrolyzer:   ElectrolyzerParams
    compressor:     CompressorParams
    storage:        StorageParams
    fuel_cell:      FuelCellParams


# ──────────────────────────────────────────────────────────────────────────────
# Mock simulation engine  (numpy-based physics, runs when MATLAB is absent)
# ──────────────────────────────────────────────────────────────────────────────

def _run_mock_simulation(req: SimulationRequest) -> Dict[str, Any]:
    """
    Step-by-step mock simulation that honours the full v2 parameter schema
    and returns the full v2 response shape (§3) plus flat v1 aliases (§7).
    """
    import numpy as np

    sim = req.simulation
    src = req.source
    elz = req.electrolyzer
    cmp = req.compressor
    stg = req.storage
    fc  = req.fuel_cell

    # ── Time axis ────────────────────────────────────────────────────────────
    N    = math.floor(sim.t_end_s / sim.dt_s) + 1
    t    = np.array([i * sim.dt_s for i in range(N)], dtype=float)
    dt_h = sim.dt_s / 3600.0  # time-step in hours

    # ── Interpolate source profile onto simulation time axis ─────────────────
    profile_t = np.array([p.time_s   for p in src.profile], dtype=float)
    profile_p = np.array([p.power_kw for p in src.profile], dtype=float)
    P_source  = np.interp(t, profile_t, profile_p,
                          left=profile_p[0], right=profile_p[-1])

    # ── Physical constants ────────────────────────────────────────────────────
    H2_LHV_kWh_Nm3  = 3.00          # kWh / Nm³   (LHV basis)
    H2_density_kgNm3 = 0.0899       # kg  / Nm³   (0 °C, 1 atm)
    H2_HHV_kWh_kg   = elz.h2_hhv_kwh_per_kg   # kWh / kg  (HHV basis)
    R_gas  = 8.314                  # J / (mol·K)
    M_h2   = 0.002016               # kg / mol
    T_amb  = 293.0                  # K  (20 °C)
    V_tank = 10.0                   # m³  assumed vessel volume

    # ── Storage initialisation (ideal gas) ───────────────────────────────────
    m_h2_at_max = stg.max_pressure_bar * 1e5 * V_tank * M_h2 / (R_gas * T_amb)
    m_h2_at_min = stg.min_pressure_bar * 1e5 * V_tank * M_h2 / (R_gas * T_amb)
    m_h2_usable = max(m_h2_at_max - m_h2_at_min, 1e-9)
    m_h2        = m_h2_at_min + (stg.initial_soc_pct / 100.0) * m_h2_usable
    eta_rt      = stg.round_trip_efficiency_pct / 100.0

    # ── Electrolyzer thresholds ───────────────────────────────────────────────
    P_min_elz   = elz.min_load_pct / 100.0 * elz.capacity_kw
    P_max_elz   = elz.max_load_pct / 100.0 * elz.capacity_kw
    eta_nom_hhv = elz.nominal_efficiency_pct_hhv / 100.0

    # ── Fuel cell thresholds ─────────────────────────────────────────────────
    fc_rated    = fc.rated_power_kw if fc.rated_power_kw else elz.capacity_kw
    P_min_fc    = fc.min_load_pct / 100.0 * fc_rated
    eta_nom_lhv = fc.nominal_efficiency_pct / 100.0

    # Representative PEM fuel-cell V-I stack parameters
    N_cells_fc = 200
    A_cell_cm2 = 400.0

    # ── Output arrays ────────────────────────────────────────────────────────
    elz_power_kw       = np.zeros(N)
    elz_h2_nm3h        = np.zeros(N)
    elz_h2_kg_h        = np.zeros(N)
    elz_efficiency_pct = np.zeros(N)
    elz_temp_c         = np.zeros(N)

    cmp_power_kw   = np.zeros(N)
    cmp_outlet_bar = np.zeros(N)

    stg_pressure_bar = np.zeros(N)
    stg_soc_pct      = np.zeros(N)
    stg_h2_mass_kg   = np.zeros(N)

    fc_power_kw      = np.zeros(N)
    fc_h2_nm3h       = np.zeros(N)
    fc_voltage_v     = np.zeros(N)
    fc_current_acm2  = np.zeros(N)
    fc_eff_pct       = np.zeros(N)

    T_elz = 25.0  # stack starts at ambient

    # ── Step-by-step simulation ───────────────────────────────────────────────
    for i in range(N):
        # Storage snapshot at start of step
        p_bar = float(np.clip(
            m_h2 * R_gas * T_amb / (V_tank * M_h2) / 1e5,
            0.0, stg.max_pressure_bar,
        ))
        soc = float(np.clip(
            (m_h2 - m_h2_at_min) / m_h2_usable * 100.0, 0.0, 100.0,
        ))
        stg_pressure_bar[i] = p_bar
        stg_soc_pct[i]      = soc
        stg_h2_mass_kg[i]   = float(m_h2)

        # ── Electrolyzer ──────────────────────────────────────────────────────
        P_avail   = float(np.clip(P_source[i], 0.0, P_max_elz))
        elz_on    = (P_avail >= P_min_elz) and (p_bar < stg.max_pressure_bar)

        if elz_on:
            P_elz     = P_avail
            load_frac = P_elz / elz.capacity_kw
            if elz.tech_type == "alkaline":
                eta_pl = (eta_nom_hhv * min(1.0, 0.65 + 0.875 * load_frac)
                          if load_frac < 0.4 else eta_nom_hhv)
            else:
                eta_pl = eta_nom_hhv * (0.90 + 0.10 * load_frac)
            eta_pl  = float(np.clip(eta_pl, 0.3, 1.0))
            h2_kg_h = P_elz * eta_pl / H2_HHV_kWh_kg
            h2_nm3h = h2_kg_h / H2_density_kgNm3
            T_elz  += (elz.operating_temperature_c - T_elz) * 0.025
        else:
            P_elz = 0.0; eta_pl = 0.0; h2_kg_h = 0.0; h2_nm3h = 0.0
            T_elz += (25.0 - T_elz) * 0.01

        elz_power_kw[i]       = P_elz
        elz_h2_kg_h[i]        = h2_kg_h
        elz_h2_nm3h[i]        = h2_nm3h
        elz_efficiency_pct[i] = eta_pl * 100.0 if P_elz > 0 else 0.0
        elz_temp_c[i]         = T_elz

        # ── Compressor ───────────────────────────────────────────────────────
        if h2_kg_h > 0.0 and p_bar < cmp.target_pressure_bar:
            n_poly  = 1.4
            p_ratio = cmp.target_pressure_bar / max(cmp.inlet_pressure_bar, 1e-3)
            m_dot   = h2_kg_h / 3600.0  # kg/s
            W_isen  = (m_dot * R_gas * T_amb / M_h2
                       * n_poly / (n_poly - 1)
                       * (p_ratio ** ((n_poly - 1) / n_poly) - 1))  # W
            P_cmp   = W_isen / max(cmp.isentropic_efficiency_frac, 0.01) / 1000.0
            p_out   = min(cmp.target_pressure_bar,
                          p_bar + (cmp.target_pressure_bar - p_bar) * 0.04)
        else:
            P_cmp = 0.0; p_out = p_bar

        cmp_power_kw[i]   = float(P_cmp)
        cmp_outlet_bar[i] = float(p_out)

        # ── Storage: add H2 from ELZ ─────────────────────────────────────────
        m_h2 = float(np.clip(m_h2 + h2_kg_h * dt_h * eta_rt,
                             0.0, m_h2_at_max))

        # ── Fuel cell ────────────────────────────────────────────────────────
        if p_bar > stg.min_pressure_bar:
            m_drawable    = max(m_h2 - m_h2_at_min, 0.0)
            q_avail       = m_drawable / H2_density_kgNm3 / dt_h   # Nm³/h
            q_h2          = min(fc.h2_flow_rate_nm3h, q_avail)
            P_fc_cand     = q_h2 * H2_LHV_kWh_Nm3 * eta_nom_lhv    # kW
            if P_fc_cand >= P_min_fc:
                P_fc      = P_fc_cand
                q_h2_out  = q_h2
                i_fc      = float(np.clip(
                    P_fc * 1000.0 / max(N_cells_fc * A_cell_cm2 * 0.7, 1.0),
                    0.01, 2.0,
                ))
                V_cell    = float(np.clip(0.72 - 0.055 * i_fc, 0.3, 1.0))
                V_term    = V_cell * N_cells_fc
                eta_inst  = (P_fc / max(q_h2_out * H2_LHV_kWh_Nm3, 1e-9)) * 100.0
            else:
                P_fc = 0.0; q_h2_out = 0.0
                i_fc = 0.0; V_term = 0.0; eta_inst = 0.0
        else:
            P_fc = 0.0; q_h2_out = 0.0
            i_fc = 0.0; V_term = 0.0; eta_inst = 0.0

        fc_power_kw[i]     = P_fc
        fc_h2_nm3h[i]      = q_h2_out
        fc_voltage_v[i]    = V_term
        fc_current_acm2[i] = i_fc
        fc_eff_pct[i]      = float(np.clip(eta_inst, 0.0, 100.0))

        # Remove consumed H2 from storage
        m_h2 = float(np.clip(
            m_h2 - q_h2_out * H2_density_kgNm3 * dt_h,
            0.0, m_h2_at_max,
        ))

    # ── KPI aggregates ────────────────────────────────────────────────────────
    total_h2_produced_kg = float(np.sum(elz_h2_kg_h)  * dt_h)
    total_h2_consumed_kg = float(np.sum(fc_h2_nm3h)   * H2_density_kgNm3 * dt_h)
    total_energy_kwh     = float(np.sum(elz_power_kw + cmp_power_kw) * dt_h)
    fc_energy_out_kwh    = float(np.sum(fc_power_kw)  * dt_h)

    active_steps = int(np.sum(elz_power_kw > 0))
    overall_eff  = (fc_energy_out_kwh / max(total_energy_kwh, 1e-9)) * 100.0
    specific_e   = total_energy_kwh / max(total_h2_produced_kg, 1e-9)
    peak_h2_kg_h = float(np.max(elz_h2_kg_h))
    nz           = elz_power_kw[elz_power_kw > 0]
    avg_elz_load = float(np.mean(nz / elz.capacity_kw * 100.0)) if len(nz) > 0 else 0.0
    cf_pct       = active_steps / N * 100.0

    def lst(arr: "np.ndarray") -> List[float]:
        return [round(float(v), 4) for v in arr]

    # ── Build v2 response with v1 flat aliases ────────────────────────────────
    return {
        "time_s": lst(t),
        "electrolyzer": {
            "power_in_kw":         lst(elz_power_kw),
            "h2_production_nm3h":  lst(elz_h2_nm3h),
            "h2_production_kg_h":  lst(elz_h2_kg_h),
            "efficiency_pct":      lst(elz_efficiency_pct),
            "stack_temperature_c": lst(elz_temp_c),
        },
        "compressor": {
            "power_consumed_kw":  lst(cmp_power_kw),
            "outlet_pressure_bar": lst(cmp_outlet_bar),
        },
        "storage": {
            "pressure_bar": lst(stg_pressure_bar),
            "soc_pct":      lst(stg_soc_pct),
            "h2_mass_kg":   lst(stg_h2_mass_kg),
        },
        "fuel_cell": {
            "power_output_kw":      lst(fc_power_kw),
            "h2_consumed_nm3h":     lst(fc_h2_nm3h),
            "terminal_voltage_v":   lst(fc_voltage_v),
            "current_density_acm2": lst(fc_current_acm2),
            "efficiency_pct":       lst(fc_eff_pct),
        },
        "kpi": {
            "total_h2_produced_kg":          round(total_h2_produced_kg, 3),
            "total_h2_consumed_kg":          round(total_h2_consumed_kg, 3),
            "total_energy_consumed_kwh":     round(total_energy_kwh, 3),
            "overall_system_efficiency_pct": round(overall_eff, 2),
            "specific_energy_kwh_kg":        round(specific_e, 2),
            "peak_h2_production_kg_h":       round(peak_h2_kg_h, 4),
            "avg_electrolyzer_load_pct":     round(avg_elz_load, 2),
            "capacity_factor_pct":           round(cf_pct, 2),
        },
        # v1 flat aliases (§7)
        "electrolyzer_power_kw":   lst(elz_power_kw),
        "h2_production_nm3h":      lst(elz_h2_nm3h),
        "tank_pressure_bar":       lst(stg_pressure_bar),
        "fc_terminal_voltage_v":   lst(fc_voltage_v),
        "fc_current_density_acm2": lst(fc_current_acm2),
        "fc_power_output_kw":      lst(fc_power_kw),
        "system_efficiency_pct":   lst(
            np.clip(
                np.divide(fc_power_kw, np.maximum(elz_power_kw, 1.0)) * 100.0,
                0.0, 100.0,
            )
        ),
    }


# ──────────────────────────────────────────────────────────────────────────────
# OpenModelica-based simulation  (v2 parameter mapping)
# ──────────────────────────────────────────────────────────────────────────────

def _run_openmodelica_simulation(req: SimulationRequest) -> Dict[str, Any]:
    """
    Runs H2 plant simulation using OpenModelica CompleteSystem model.
    Passes v2.0 request parameters to the Modelica model and parses results.
    """
    with _omc_lock:
        omc = _omc

    if omc is None:
        raise RuntimeError("OpenModelica engine is not running.")

    import numpy as np
    
    sim = req.simulation
    src = req.source
    elz = req.electrolyzer
    cmp = req.compressor
    stg = req.storage
    fc  = req.fuel_cell

    # Create temporary directory for simulation files
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        
        # ── 1. Create power profile input file ───────────────────────────────
        N = math.floor(sim.t_end_s / sim.dt_s) + 1
        t_arr = np.linspace(0.0, sim.t_end_s, N)
        profile_t = np.array([p.time_s for p in src.profile])
        profile_p = np.array([p.power_kw for p in src.profile])
        P_src_arr = np.interp(t_arr, profile_t, profile_p,
                              left=profile_p[0], right=profile_p[-1])
        
        # Write Modelica-compatible time table
        power_profile = tmpdir_path / "power_profile.txt"
        with open(power_profile, 'w') as f:
            f.write("#1\n")  # Modelica table format header
            f.write("double power_profile(2, {})\n".format(N))
            for i in range(N):
                f.write(f"{t_arr[i]}\t{P_src_arr[i]}\n")
        
        # ── 2. Build model with parameters ───────────────────────────────────
        # Set working directory
        omc.sendExpression(f'cd("{tmpdir}")')
        
        # Load the CompleteSystem model (already loaded in startup)
        model_name = "H2PowerPlant.CompleteSystem"
        
        # Build parameter override string
        params = {
            # Electrolyzer
            "elz_tech": f'"{elz.tech_type}"',
            "elz_P_rated": elz.capacity_kw,
            "elz_eta_hhv": elz.nominal_efficiency_pct_hhv / 100.0,
            "elz_P_min": elz.min_load_pct / 100.0 * elz.capacity_kw,
            "elz_P_max": elz.max_load_pct / 100.0 * elz.capacity_kw,
            "elz_T_op": elz.operating_temperature_c,
            "elz_q_water": elz.water_flow_rate_lpm,
            "elz_HHV": elz.h2_hhv_kwh_per_kg,
            # Compressor
            "cmp_tech": f'"{cmp.tech_type}"',
            "cmp_eta_isen": cmp.isentropic_efficiency_frac,
            "cmp_p_in": cmp.inlet_pressure_bar,
            "cmp_p_target": cmp.target_pressure_bar,
            # Storage
            "stg_tech": f'"{stg.tech_type}"',
            "stg_p_max": stg.max_pressure_bar,
            "stg_p_min": stg.min_pressure_bar,
            "stg_soc0": stg.initial_soc_pct / 100.0,
            "stg_eta_rt": stg.round_trip_efficiency_pct / 100.0,
            "stg_V_tank": 10,  # Fixed tank volume for now
            # Fuel cell
            "fc_tech": f'"{fc.tech_type}"',
            "fc_P_rated": fc.rated_power_kw or elz.capacity_kw,
            "fc_eta_lhv": fc.nominal_efficiency_pct / 100.0,
            "fc_P_min": fc.min_load_pct / 100.0 * (fc.rated_power_kw or elz.capacity_kw),
            "fc_q_h2_rated": fc.h2_flow_rate_nm3h,
            "fc_p_op": fc.operating_pressure_bar,
            "fc_Q_cool": fc.cooling_capacity_kw,
        }
        
        param_string = ",".join([f"{k}={v}" for k, v in params.items()])
        # String-valued overrides (e.g., tech_type) include quotes.
        # Escape them before embedding in simflags="-override=...".
        param_string_om = param_string.replace('"', '\\"')
        
        log.info(f"Simulating {model_name} with parameters: {param_string[:200]}...")
        
        # ── 3. Run simulation ─────────────────────────────────────────────────
        # Calculate number of output intervals for OpenModelica
        num_intervals = int(sim.t_end_s / sim.dt_s)
        
        result = omc.sendExpression(
            f'simulate({model_name}, startTime=0, stopTime={sim.t_end_s}, '
            f'numberOfIntervals={num_intervals}, tolerance=1e-6, '
            f'simflags="-override={param_string_om}")'
        )
        
        if not result or 'resultFile' not in str(result):
            error_str = omc.sendExpression('getErrorString()')
            diag = _collect_omc_diagnostics(omc, model_name)
            raise RuntimeError(
                f"OpenModelica simulation failed: {error_str}; diagnostics={diag}"
            )
        
        log.info(f"Simulation completed: {result}")
        
        # ── 4. Parse results ──────────────────────────────────────────────────
        # OpenModelica writes results to .mat file
        result_file = result.get('resultFile', '')
        if not result_file or not os.path.exists(result_file):
            result_file = str(tmpdir_path / f"{model_name.replace('.', '_')}_res.mat")
        
        # Read results using OMPython
        variables = [
            'time',
            'electrolyzer.P_consumed',
            'electrolyzer.h2_flow',
            'electrolyzer.h2_flow_nm3h',
            'electrolyzer.efficiency',
            'compressor.P_consumed',
            'compressor.p_out',
            'storage.pressure',
            'storage.soc',
            'storage.h2_mass',
            'fuelCell.P_output',
            'fuelCell.h2_consumed',
            'fuelCell.V_terminal',
            'fuelCell.i_density',
            'fuelCell.efficiency',
        ]
        
        def _extract_numeric_series(val: Any, target_len: int) -> List[float]:
            """Flatten OMC return payloads and extract the longest numeric series."""
            candidates: List[List[float]] = []

            def _collect(node: Any) -> None:
                if isinstance(node, (list, tuple)):
                    if node and all(not isinstance(x, (list, tuple, dict)) for x in node):
                        try:
                            candidates.append([float(x) for x in node])
                        except Exception:
                            pass
                    else:
                        for x in node:
                            _collect(x)
                else:
                    try:
                        candidates.append([float(node)])
                    except Exception:
                        pass

            _collect(val)

            if not candidates:
                return [0.0] * target_len

            best = max(candidates, key=len)
            if len(best) == target_len:
                return best
            if len(best) > target_len:
                return best[:target_len]
            if len(best) == 1:
                return best * target_len
            return best + [best[-1]] * (target_len - len(best))

        data = {}
        for var in variables:
            try:
                val = omc.sendExpression(f'readSimulationResult("{result_file}", {{{var}}})')
                data[var] = _extract_numeric_series(val, N)
            except Exception as e:
                log.warning(f"Could not read variable {var}: {e}")
                data[var] = [0.0] * N
        
        # ── 5. Build response matching v2.0 schema ───────────────────────────
        time_s = data.get('time', list(t_arr))
        
        elz_power_kw = data.get('electrolyzer.P_consumed', [0] * N)
        elz_h2_kg_h = data.get('electrolyzer.h2_flow', [0] * N)
        elz_h2_nm3h = data.get('electrolyzer.h2_flow_nm3h', [0] * N)
        elz_eff_pct = [e * 100 for e in data.get('electrolyzer.efficiency', [0] * N)]
        
        cmp_power_kw = data.get('compressor.P_consumed', [0] * N)
        cmp_p_out = data.get('compressor.p_out', [0] * N)
        
        stg_pressure = data.get('storage.pressure', [0] * N)
        stg_soc = [s * 100 for s in data.get('storage.soc', [0] * N)]
        stg_mass = data.get('storage.h2_mass', [0] * N)
        
        fc_power_kw = data.get('fuelCell.P_output', [0] * N)
        fc_h2_nm3h = data.get('fuelCell.h2_consumed', [0] * N)
        fc_voltage = data.get('fuelCell.V_terminal', [0] * N)
        fc_current = data.get('fuelCell.i_density', [0] * N)
        fc_eff_pct = [e * 100 for e in data.get('fuelCell.efficiency', [0] * N)]
        
        # Calculate KPIs
        dt_h = sim.dt_s / 3600
        total_h2_produced = sum(elz_h2_kg_h) * dt_h
        total_h2_consumed = sum([h * 0.0899 for h in fc_h2_nm3h]) * dt_h
        total_energy = sum([e + c for e, c in zip(elz_power_kw, cmp_power_kw)]) * dt_h
        fc_energy_out = sum(fc_power_kw) * dt_h
        
        overall_eff = (fc_energy_out / max(total_energy, 1e-9)) * 100 if total_energy > 0 else 0
        specific_e = total_energy / max(total_h2_produced, 1e-9) if total_h2_produced > 0 else 0
        peak_h2 = max(elz_h2_kg_h) if elz_h2_kg_h else 0
        active_steps = sum(1 for p in elz_power_kw if p > 0)
        avg_load = (sum([p / elz.capacity_kw * 100 for p in elz_power_kw if p > 0]) / active_steps 
                    if active_steps > 0 else 0)
        cf_pct = active_steps / N * 100
        
        return {
            "time_s": [float(t) for t in time_s],
            "electrolyzer": {
                "power_in_kw": [float(v) for v in elz_power_kw],
                "h2_production_nm3h": [float(v) for v in elz_h2_nm3h],
                "h2_production_kg_h": [float(v) for v in elz_h2_kg_h],
                "efficiency_pct": [float(v) for v in elz_eff_pct],
                "stack_temperature_c": [float(elz.operating_temperature_c)] * N,
            },
            "compressor": {
                "power_consumed_kw": [float(v) for v in cmp_power_kw],
                "outlet_pressure_bar": [float(v) for v in cmp_p_out],
            },
            "storage": {
                "pressure_bar": [float(v) for v in stg_pressure],
                "soc_pct": [float(v) for v in stg_soc],
                "h2_mass_kg": [float(v) for v in stg_mass],
            },
            "fuel_cell": {
                "power_output_kw": [float(v) for v in fc_power_kw],
                "h2_consumed_nm3h": [float(v) for v in fc_h2_nm3h],
                "terminal_voltage_v": [float(v) for v in fc_voltage],
                "current_density_acm2": [float(v) for v in fc_current],
                "efficiency_pct": [float(v) for v in fc_eff_pct],
            },
            "kpi": {
                "total_h2_produced_kg": round(total_h2_produced, 3),
                "total_h2_consumed_kg": round(total_h2_consumed, 3),
                "total_energy_consumed_kwh": round(total_energy, 3),
                "overall_system_efficiency_pct": round(overall_eff, 2),
                "specific_energy_kwh_kg": round(specific_e, 2),
                "peak_h2_production_kg_h": round(peak_h2, 4),
                "avg_electrolyzer_load_pct": round(avg_load, 2),
                "capacity_factor_pct": round(cf_pct, 2),
            },
            # v1 flat aliases for backwards compatibility
            "electrolyzer_power_kw": [float(v) for v in elz_power_kw],
            "h2_production_nm3h": [float(v) for v in elz_h2_nm3h],
            "tank_pressure_bar": [float(v) for v in stg_pressure],
            "fc_terminal_voltage_v": [float(v) for v in fc_voltage],
            "fc_current_density_acm2": [float(v) for v in fc_current],
            "fc_power_output_kw": [float(v) for v in fc_power_kw],
            "system_efficiency_pct": [
                round((fc / max(elz, 1)) * 100, 2) if elz > 0 else 0
                for elz, fc in zip(elz_power_kw, fc_power_kw)
            ],
        }


# ──────────────────────────────────────────────────────────────────────────────
# WebSocket broadcast helper (thread-safe bridge to asyncio loop)
# ──────────────────────────────────────────────────────────────────────────────

def _broadcast(job_id: str, payload: Dict[str, Any], loop: asyncio.AbstractEventLoop) -> None:
    src = req.source
    elz = req.electrolyzer
    cmp = req.compressor
    stg = req.storage
    fc  = req.fuel_cell

    # ── Workspace scalar / array variables per §10 ────────────────────────────
    eng.workspace["t_end"]       = float(sim.t_end_s)
    eng.workspace["dt"]          = float(sim.dt_s)
    eng.workspace["source_tech"] = src.tech_type

    # Interpolate source profile onto simulation grid
    N         = math.floor(sim.t_end_s / sim.dt_s) + 1
    t_arr     = np.linspace(0.0, sim.t_end_s, N)
    profile_t = np.array([p.time_s   for p in src.profile])
    profile_p = np.array([p.power_kw for p in src.profile])
    P_src_arr = np.interp(t_arr, profile_t, profile_p,
                          left=profile_p[0], right=profile_p[-1])
    eng.workspace["P_source"] = matlab.double(P_src_arr.tolist())  # keep for scripts/debugging

    # ── Build sub-structs following §10 naming ────────────────────────────────
    # NOTE: P_source is also added to params_struct so the function's local
    # workspace receives it directly (eng.workspace only affects the base
    # workspace — not visible inside a called function via exist('var')).
    elz_struct = eng.struct(
        "P_rated",  float(elz.capacity_kw),
        "eta_hhv",  float(elz.nominal_efficiency_pct_hhv / 100.0),
        "P_min",    float(elz.min_load_pct  / 100.0 * elz.capacity_kw),
        "P_max",    float(elz.max_load_pct  / 100.0 * elz.capacity_kw),
        "T_op",     float(elz.operating_temperature_c),
        "q_water",  float(elz.water_flow_rate_lpm),
        "HHV",      float(elz.h2_hhv_kwh_per_kg),
        "tech",     elz.tech_type,
    )
    cmp_struct = eng.struct(
        "eta_isen", float(cmp.isentropic_efficiency_frac),
        "p_in",     float(cmp.inlet_pressure_bar),
        "p_target", float(cmp.target_pressure_bar),
        "tech",     cmp.tech_type,
    )
    stg_struct = eng.struct(
        "p_max",  float(stg.max_pressure_bar),
        "p_min",  float(stg.min_pressure_bar),
        "soc0",   float(stg.initial_soc_pct / 100.0),
        "eta_rt", float(stg.round_trip_efficiency_pct / 100.0),
        "tech",   stg.tech_type,
    )
    fc_struct = eng.struct(
        "P_rated", float(fc.rated_power_kw) if fc.rated_power_kw else float(elz.capacity_kw),
        "eta_lhv", float(fc.nominal_efficiency_pct / 100.0),
        "P_min",   float(fc.min_load_pct / 100.0
                         * (fc.rated_power_kw or elz.capacity_kw)),
        "q_h2",    float(fc.h2_flow_rate_nm3h),
        "p_op",    float(fc.operating_pressure_bar),
        "Q_cool",  float(fc.cooling_capacity_kw),
        "tech",    fc.tech_type,
    )
    sim_struct = eng.struct(
        "t_end_s", float(sim.t_end_s),
        "dt_s",    float(sim.dt_s),
    )
    params_struct = eng.struct(
        "ELZ",        elz_struct,
        "CMP",        cmp_struct,
        "STG",        stg_struct,
        "FC",         fc_struct,
        "simulation", sim_struct,
        "P_source",   matlab.double(P_src_arr.tolist()),   # passed here so the
        # MATLAB function's local workspace can access it directly — eng.workspace
        # only sets the base workspace which is NOT visible inside called functions.
    )

    raw: Dict[str, Any] = eng.simulate_hydrogen_plant(params_struct, nargout=1)

    def _ml_list(v) -> List[float]:
        try:
            return [float(x) for x in v[0]]
        except Exception:
            try:
                return [float(x) for x in v]
            except Exception:
                return [float(v)]

    def _ml_scalar(v) -> float:
        try:
            return float(v)
        except Exception:
            return float(list(v)[0])

    # ── Extract from nested v2 output (with v1 fallbacks) ────────────────────
    elz_r = raw.get("electrolyzer", {})
    cmp_r = raw.get("compressor", {})
    stg_r = raw.get("storage", {})
    fc_r  = raw.get("fuel_cell", {})
    kpi_r = raw.get("kpi", {})

    return {
        "time_s": _ml_list(raw["time_s"]),
        "electrolyzer": {
            "power_in_kw":         _ml_list(elz_r.get("power_in_kw",        raw.get("electrolyzer_power_kw", [0.0]))),
            "h2_production_nm3h":  _ml_list(elz_r.get("h2_production_nm3h", raw.get("h2_production_nm3h",    [0.0]))),
            "h2_production_kg_h":  _ml_list(elz_r.get("h2_production_kg_h",  [0.0])),
            "efficiency_pct":      _ml_list(elz_r.get("efficiency_pct",       [0.0])),
            "stack_temperature_c": _ml_list(elz_r.get("stack_temperature_c",  [0.0])),
        },
        "compressor": {
            "power_consumed_kw":  _ml_list(cmp_r.get("power_consumed_kw",   [0.0])),
            "outlet_pressure_bar": _ml_list(cmp_r.get("outlet_pressure_bar", raw.get("tank_pressure_bar", [0.0]))),
        },
        "storage": {
            "pressure_bar": _ml_list(stg_r.get("pressure_bar", raw.get("tank_pressure_bar", [0.0]))),
            "soc_pct":      _ml_list(stg_r.get("soc_pct",      [0.0])),
            "h2_mass_kg":   _ml_list(stg_r.get("h2_mass_kg",   [0.0])),
        },
        "fuel_cell": {
            "power_output_kw":      _ml_list(fc_r.get("power_output_kw",      raw.get("fc_power_output_kw",      [0.0]))),
            "h2_consumed_nm3h":     _ml_list(fc_r.get("h2_consumed_nm3h",     [0.0])),
            "terminal_voltage_v":   _ml_list(fc_r.get("terminal_voltage_v",   raw.get("fc_terminal_voltage_v",   [0.0]))),
            "current_density_acm2": _ml_list(fc_r.get("current_density_acm2", raw.get("fc_current_density_acm2", [0.0]))),
            "efficiency_pct":       _ml_list(fc_r.get("efficiency_pct",        [0.0])),
        },
        "kpi": {
            "total_h2_produced_kg":          _ml_scalar(kpi_r.get("total_h2_produced_kg",          kpi_r.get("avg_h2_production_nm3h", 0.0))),
            "total_h2_consumed_kg":          _ml_scalar(kpi_r.get("total_h2_consumed_kg",          0.0)),
            "total_energy_consumed_kwh":     _ml_scalar(kpi_r.get("total_energy_consumed_kwh",     0.0)),
            "overall_system_efficiency_pct": _ml_scalar(kpi_r.get("overall_system_efficiency_pct", kpi_r.get("system_efficiency_pct", 0.0))),
            "specific_energy_kwh_kg":        _ml_scalar(kpi_r.get("specific_energy_kwh_kg",        0.0)),
            "peak_h2_production_kg_h":       _ml_scalar(kpi_r.get("peak_h2_production_kg_h",       0.0)),
            "avg_electrolyzer_load_pct":     _ml_scalar(kpi_r.get("avg_electrolyzer_load_pct",     0.0)),
            "capacity_factor_pct":           _ml_scalar(kpi_r.get("capacity_factor_pct",           0.0)),
        },
        # v1 flat aliases
        "electrolyzer_power_kw":   _ml_list(raw.get("electrolyzer_power_kw",   [0.0])),
        "h2_production_nm3h":      _ml_list(raw.get("h2_production_nm3h",      [0.0])),
        "tank_pressure_bar":       _ml_list(raw.get("tank_pressure_bar",        [0.0])),
        "fc_terminal_voltage_v":   _ml_list(raw.get("fc_terminal_voltage_v",    [0.0])),
        "fc_current_density_acm2": _ml_list(raw.get("fc_current_density_acm2",  [0.0])),
        "fc_power_output_kw":      _ml_list(raw.get("fc_power_output_kw",       [0.0])),
        "system_efficiency_pct":   _ml_list(raw.get("system_efficiency_pct",    [0.0])),
    }


# ──────────────────────────────────────────────────────────────────────────────
# WebSocket broadcast helper (thread-safe bridge to asyncio loop)
# ──────────────────────────────────────────────────────────────────────────────

def _broadcast(job_id: str, payload: Dict[str, Any], loop: asyncio.AbstractEventLoop) -> None:
    """Push a message to all WebSocket clients subscribed to job_id."""
    import json as _json

    clients = list(_ws_clients.get(job_id, []))
    if not clients:
        return

    async def _send_all() -> None:
        dead: List[WebSocket] = []
        for ws in clients:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        if dead:
            existing = _ws_clients.get(job_id, [])
            _ws_clients[job_id] = [c for c in existing if c not in dead]

    loop.call_soon_threadsafe(asyncio.ensure_future, _send_all())


# ──────────────────────────────────────────────────────────────────────────────
# Simulation worker (runs in ThreadPoolExecutor)
# ──────────────────────────────────────────────────────────────────────────────

def _run_simulation(
    job_id: str,
    req: SimulationRequest,
    loop: asyncio.AbstractEventLoop,
) -> None:
    """Worker executed in a thread-pool thread."""

    def progress(pct: int) -> None:
        jobs[job_id]["progress_pct"] = pct
        _broadcast(job_id, {"type": "progress", "progress_pct": pct}, loop)

    try:
        jobs[job_id]["status"] = JobStatus.running
        progress(0)

        if OPENMODELICA_AVAILABLE and _omc is not None:
            log.info("Job %s: using OpenModelica engine.", job_id)
            progress(20)
            time.sleep(0.5)
            progress(50)
            try:
                result = _run_openmodelica_simulation(req)
                progress(90)
            except Exception as om_err:
                # Fallback so UI still gets physically meaningful series while we
                # surface full OMC diagnostics for debugging.
                log.exception("Job %s: OpenModelica failed, switching to local fallback.", job_id)
                result = _run_mock_simulation(req)
                result["fallback"] = {
                    "engine": "mock",
                    "reason": str(om_err),
                }
                progress(90)
        else:
            log.info("Job %s: using mock engine.", job_id)
            progress(20)
            time.sleep(1)
            progress(50)
            time.sleep(1)
            result = _run_mock_simulation(req)
            progress(90)
            time.sleep(0.5)

        jobs[job_id]["status"]       = JobStatus.done
        jobs[job_id]["progress_pct"] = 100
        jobs[job_id]["result"]       = result

        _broadcast(job_id, {"type": "result", "result": result}, loop)
        log.info("Job %s completed successfully.", job_id)

    except Exception as exc:
        err_msg = str(exc)
        log.exception("Job %s failed: %s", job_id, err_msg)
        jobs[job_id]["status"] = JobStatus.error
        jobs[job_id]["error"]  = err_msg
        _broadcast(job_id, {"type": "error", "error": err_msg}, loop)


# ──────────────────────────────────────────────────────────────────────────────
# FastAPI lifespan
# ──────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("hydrogen-plant-sim (OpenModelica) - schema v2.0 starting …")
    if _AUTO_START_ENGINE:
        t = threading.Thread(target=_start_openmodelica_engine, name="openmodelica-engine", daemon=True)
        t.start()
        log.info("OpenModelica engine initialisation thread launched.")
    else:
        log.info("AUTO_START_ENGINE=0: skipping engine startup at boot; use /api/restart-engine after activation.")
    yield
    log.info("hydrogen-plant-sim shutting down …")
    _executor.shutdown(wait=False)
    with _omc_lock:
        if _omc is not None:
            try:
                _omc.sendExpression('quit()')
                log.info("OpenModelica engine stopped.")
            except Exception as exc:
                log.warning("Error stopping OpenModelica engine: %s", exc)


# ──────────────────────────────────────────────────────────────────────────────
# FastAPI application
# ──────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Hydrogen Plant Simulation Bridge (OpenModelica)",
    version="2.0.0",
    description=(
        "FastAPI server bridging the TEMPO Digital Twin "
        "and OpenModelica simulation engine. Schema v2.0. "
        "Replaced MATLAB with open-source OpenModelica for better Docker compatibility."
    ),
    lifespan=lifespan,
)

# CORS
_cors_origins_env = os.getenv("CORS_ORIGINS", "*")
_cors_origins = (
    ["*"]
    if _cors_origins_env.strip() == "*"
    else [o.strip() for o in _cors_origins_env.split(",")]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────────

def _health_payload() -> Dict[str, Any]:
    engine_ready_flag = _engine_ready.is_set() and _engine_error is None
    active = sum(
        1 for j in jobs.values()
        if j["status"] in (JobStatus.queued, JobStatus.running)
    )
    return {
        "engine_ready": engine_ready_flag,
        "engine_error": _engine_error,
        "active_jobs":  active,
    }


@app.get("/api/health")
async def health_root() -> Dict[str, Any]:
    """Top-level health endpoint (alias, §4)."""
    return _health_payload()


@app.post("/api/restart-engine")
async def api_restart_engine() -> Dict[str, Any]:
    """OpenModelica engine in-place without restarting the container.
    Useful for reloading model files after changes.
    """
    global _omc, _engine_error

    # Shut down existing engine gracefully
    with _omc_lock:
        old_omc = _omc
        _omc = None
    if old_omc is not None:
        try:
            old_omc.sendExpression('quit()')
            log.info("Old OpenModelica engine stopped before restart.")
        except Exception as exc:
            log.warning("Error stopping old OpenModelica engine: %s", exc)

    # Reset state
    _engine_error = None
    _engine_ready.clear()

    # Launch fresh engine thread
    t = threading.Thread(
        target=_start_openmodelica_engine,
        name="openmodelica-engine-restart",
        daemon=True,
    )
    t.start()
    log.info("OpenModelica engine restart initiated via /api/restart-engine.")
    return {
        "status": "restarting",
        "message": "Engine restart initiated. Poll /api/health for engine_ready.",
    }


@app.get("/api/hydrogen/health")
async def health() -> Dict[str, Any]:
    """Engine state and active job count."""
    return _health_payload()


@app.post("/api/hydrogen/simulate", status_code=202)
async def simulate(body: SimulationRequest) -> Dict[str, Any]:
    """Enqueue a simulation job (schema v2.0) and return 202 + job_id."""
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "job_id":       job_id,
        "status":       JobStatus.queued,
        "progress_pct": 0,
        "error":        None,
        "result":       None,
    }
    _ws_clients[job_id] = []

    loop = asyncio.get_event_loop()
    _executor.submit(_run_simulation, job_id, body, loop)

    log.info("Enqueued simulation job %s.", job_id)
    return {
        "job_id":  job_id,
        "status":  "queued",
        "message": f"Simulation job {job_id} queued successfully.",
    }


@app.get("/api/hydrogen/status/{job_id}")
async def status(job_id: str) -> Dict[str, Any]:
    """Poll job status and progress (result omitted — use /result endpoint)."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found.")
    j = jobs[job_id]
    return {
        "job_id":       j["job_id"],
        "status":       j["status"],
        "progress_pct": j["progress_pct"],
        "error":        j["error"],
        "result":       None,
    }


@app.get("/api/hydrogen/result/{job_id}")
async def result(job_id: str) -> Dict[str, Any]:
    """Retrieve the full simulation result once the job is done (§4)."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found.")
    j = jobs[job_id]
    if j["status"] == JobStatus.error:
        raise HTTPException(status_code=500, detail=j["error"])
    if j["status"] != JobStatus.done:
        raise HTTPException(
            status_code=202,
            detail=(
                f"Job not finished yet. "
                f"status={j['status']}  progress={j['progress_pct']}%"
            ),
        )
    return {
        "job_id":       j["job_id"],
        "status":       j["status"],
        "progress_pct": 100,
        "error":        None,
        "result":       j["result"],
    }


@app.websocket("/api/hydrogen/ws/{job_id}")
async def ws_endpoint(websocket: WebSocket, job_id: str) -> None:
    """
    WebSocket: real-time progress and result delivery.
    Messages pushed by server:
      {"type": "progress", "progress_pct": N}
      {"type": "result",   "result": {...}}
      {"type": "error",    "error": "..."}
    """
    await websocket.accept()
    log.info("WS client connected for job %s.", job_id)

    if job_id not in _ws_clients:
        _ws_clients[job_id] = []
    _ws_clients[job_id].append(websocket)

    # Push current state immediately if job already settled
    if job_id in jobs:
        j = jobs[job_id]
        if j["status"] == JobStatus.done:
            await websocket.send_json({"type": "result",   "result": j["result"]})
        elif j["status"] == JobStatus.error:
            await websocket.send_json({"type": "error",    "error":  j["error"]})
        elif j["status"] in (JobStatus.running, JobStatus.queued):
            await websocket.send_json({"type": "progress", "progress_pct": j["progress_pct"]})

    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        log.info("WS client disconnected from job %s.", job_id)
    except Exception as exc:
        log.warning("WS error for job %s: %s", job_id, exc)
    finally:
        if job_id in _ws_clients:
            _ws_clients[job_id] = [c for c in _ws_clients[job_id] if c is not websocket]


# ──────────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
