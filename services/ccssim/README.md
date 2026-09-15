# CCS Plant Simulation Service

FastAPI + OpenModelica-based Carbon Capture and Storage (CCS) simulation service for the TEMPO platform.

## Overview

This service simulates a complete CCS plant with:
- **CO2 Source** - Flue gas from power plants or industrial processes
- **Absorber** - Chemical absorption using MEA or other solvents
- **Stripper** - Solvent regeneration and CO2 release
- **Compressor** - Multi-stage compression to pipeline/storage pressure
- **Storage** - Geological formation monitoring (depleted fields, saline aquifers)

## Architecture

- **Port**: 8766 (configurable via PORT env var)
- **Schema Version**: 2.0
- **Engine**: OpenModelica (with mock fallback)
- **Framework**: FastAPI + Pydantic
- **Container**: Docker (~500MB)

## Quick Start

### Local Development (Python)

```bash
# Install dependencies
pip install -r requirements.txt

# Run the service
python main.py
```

The service will start on `http://localhost:8766`.

### Docker

```bash
# Build the image
docker build -t ccs-sim:latest .

# Run the container
docker run -d \
  --name ccs-sim \
  -p 8766:8766 \
  ccs-sim:latest

# Check logs
docker logs -f ccs-sim

# Health check
curl http://localhost:8766/api/health
```

### Docker Compose

```bash
# Start the service
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the service
docker-compose down
```

## API Endpoints

### Health Check
```bash
GET /api/health

Response:
{
  "engine_ready": false,
  "engine_error": "Cannot find OpenModelica executable...",
  "active_jobs": 0
}
```

### Submit Simulation
```bash
POST /api/ccs/submit

Request body: SimulationRequest (see schema below)

Response:
{
  "job_id": "uuid",
  "status": "queued"
}
```

### Poll Status
```bash
GET /api/ccs/status/{job_id}

Response:
{
  "job_id": "uuid",
  "status": "done",
  "result": { ... },
  "error": null
}
```

## Request Schema (v2.0)

```json
{
  "schema_version": "2.0",
  "simulation": {
    "t_end_s": 86400,
    "dt_s": 60
  },
  "source": {
    "tech_type": "coal_plant",
    "co2_concentration_pct": 15.0,
    "flue_gas_flow_nm3h": 500000,
    "temperature_c": 120,
    "pressure_bar": 1.2,
    "profile": [
      {"time_s": 0, "co2_tph": 100},
      {"time_s": 86400, "co2_tph": 100}
    ]
  },
  "absorber": {
    "tech_type": "mea",
    "capture_efficiency_pct": 90.0,
    "solvent_flow_rate_m3h": 200,
    "packing_height_m": 15,
    "column_diameter_m": 10,
    "operating_temperature_c": 40,
    "operating_pressure_bar": 1.1
  },
  "stripper": {
    "tech_type": "thermal",
    "regeneration_energy_kwh_tco2": 3.5,
    "steam_pressure_bar": 3.5,
    "operating_temperature_c": 120,
    "co2_purity_pct": 99.5
  },
  "compressor": {
    "tech_type": "multistage",
    "num_stages": 5,
    "isentropic_efficiency_frac": 0.85,
    "inlet_pressure_bar": 1.5,
    "target_pressure_bar": 110,
    "intercooler_efficiency_pct": 80
  },
  "storage": {
    "tech_type": "saline_aquifer",
    "max_pressure_bar": 150,
    "min_pressure_bar": 50,
    "initial_fill_pct": 0,
    "capacity_tonnes": 1000000,
    "injection_rate_tph": 100,
    "permeability_md": 100,
    "porosity_pct": 20
  }
}
```

## Integration with Frontend

The frontend (calliope_editiontool) connects via proxy:

1. **Environment variable**: `VITE_CCS_SERVICE_URL=http://localhost:8766`
2. **Vite proxy**: `/ccs-proxy` → `http://localhost:8766`
3. **Service client**: `src/services/ccsService.js`

## OpenModelica Integration

Currently using mock simulation. To enable OpenModelica:

1. Uncomment OpenModelica installation in Dockerfile
2. Create Modelica models in `modelica/CCSPlant.mo`
3. Rebuild Docker image

## Development

### Mock Simulation

The mock engine uses numpy-based chemical engineering principles:
- Mass balances for CO2 capture and storage
- Thermodynamic compressor models
- Solvent absorption kinetics
- Geological storage pressure dynamics

### Adding Custom Models

1. Create `.mo` files in `modelica/` directory
2. Update `_start_openmodelica_engine()` to load your library
3. Implement `_run_openmodelica_simulation()` function

## License

See parent repository for licensing information.

## Related Repositories

- **hydrogenmatsim** - H2 plant simulation service (port 8765)
- **calliope_editiontool** - TEMPO frontend application
- **opentech-db** - Technology catalog API
