"""
schemas/process.py
==================
Pydantic models for **Process** — a multi-equipment energy transformation
system (OEO: energy transformation chain). See ADR-0004.

A Process is a connected graph of **Units** (equipment) and **Streams** (typed,
stateful connections between Unit Ports). A Unit composes a Catalogue
Technology: it references one by ``technology_ref`` for its base Parameters and
provenance, and adds ``operating_conditions`` (setpoints) plus connectivity.
Nothing about the referenced Technology is duplicated here.

``equipment_type`` is the stable key that (in a later phase) selects the
Modelica Component model for the Unit; ``technology_ref`` supplies the Catalogue
Parameters that fill that model. Equipment the Catalogue does not yet contain
(e.g. an H₂ compressor) carries ``technology_ref = None`` until it is added.
"""

from __future__ import annotations

from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, HttpUrl, model_validator

from schemas.models import EnergyCarrier, ParameterValue


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class ProcessStatus(str, Enum):
    """Lifecycle of a Process, mirroring the Submission lifecycle (ADR-0004)."""
    DRAFT     = "draft"       # user-private, editable, simulatable — not in the Catalogue
    SUBMITTED = "submitted"   # published for review
    APPROVED  = "approved"    # merged into the shared Catalogue (seeds are born approved)


class PortDirection(str, Enum):
    IN  = "in"
    OUT = "out"


# ---------------------------------------------------------------------------
# Graph primitives
# ---------------------------------------------------------------------------

class Port(BaseModel):
    """A typed connection point on a Unit. Streams may only join compatible Ports."""
    id:        str = Field(..., description="Unique within the Unit, e.g. 'h2_out'.")
    carrier:   EnergyCarrier
    direction: PortDirection
    label:     str | None = None

    model_config = {"extra": "forbid"}


class StreamState(BaseModel):
    """Optional design / initial operating point of a Stream (thermodynamic state)."""
    temperature_c:  float | None = Field(None, description="Stream temperature [°C].")
    pressure_bar:   float | None = Field(None, description="Stream pressure [bar].")
    mass_flow_kg_s: float | None = Field(None, description="Mass flow [kg/s].")
    composition:    dict[str, float] | None = Field(
        None, description="Species → mole/mass fraction, when the carrier is a mixture.")

    model_config = {"extra": "forbid"}


class Endpoint(BaseModel):
    """One end of a Stream: a specific Port on a specific Unit."""
    unit_id: str
    port_id: str

    model_config = {"extra": "forbid"}


class Stream(BaseModel):
    """A directed connection carrying one EnergyCarrier from an OUT Port to an IN Port."""
    id:      str
    source:  Endpoint = Field(..., description="Origin Unit Port (must be an OUT port).")
    target:  Endpoint = Field(..., description="Destination Unit Port (must be an IN port).")
    carrier: EnergyCarrier
    state:   StreamState = Field(default_factory=StreamState)
    label:   str | None = None

    model_config = {"extra": "forbid"}


class Position(BaseModel):
    """Canvas layout coordinate for a Unit."""
    x: float
    y: float

    model_config = {"extra": "forbid"}


class Unit(BaseModel):
    """
    One piece of equipment in a Process. Composes a Catalogue Technology
    (``technology_ref``) for its base Parameters; ``operating_conditions`` are
    the setpoints this Process applies on top.
    """
    id:             str  = Field(..., description="Stable identifier within the Process.")
    name:           str
    equipment_type: str  = Field(
        ..., description="Component-model key selecting the Modelica model, e.g. 'electrolyzer_pem'.")
    technology_ref: str | None = Field(
        None, description="Catalogue Technology slug or UUID this Unit composes (provenance + Parameters).")
    instance_ref:   str | None = Field(
        None, description="Optional specific Instance UUID within the referenced Technology.")
    operating_conditions: dict[str, ParameterValue] = Field(
        default_factory=dict,
        description="Setpoints applied by this Process (T, P, load, …), each with provenance.")
    ports:    list[Port]     = Field(default_factory=list)
    position: Position | None = None

    model_config = {"extra": "forbid"}


# ---------------------------------------------------------------------------
# Process
# ---------------------------------------------------------------------------

class Process(BaseModel):
    """
    A multi-equipment energy transformation system — the top-level artifact.
    Contributed and versioned like a Technology (ADR-0003 storage boundary,
    ADR-0001 review gate).
    """
    id:          UUID   = Field(default_factory=uuid4)
    slug:        str    = Field(..., description="Stable, URL-safe key.")
    name:        str
    description: str | None = Field(None)
    domain:      str | None = Field(None, description="Free grouping tag, e.g. 'hydrogen', 'ccs'.")

    # OEO linkage — validated at review time (ADR-0001), so optional here.
    oeo_class:   str | None      = Field(None, description="Short OEO transformation-chain class.")
    oeo_uri:     HttpUrl | None  = Field(None)

    status:      ProcessStatus = Field(ProcessStatus.DRAFT)
    author:      str | None    = Field(None, description="Keycloak subject of the author; None for seeds.")

    units:   list[Unit]   = Field(default_factory=list)
    streams: list[Stream] = Field(default_factory=list)

    tags:    list[str]   = Field(default_factory=list)
    source:  str | None  = Field(None, description="Provenance for the Process design itself.")
    year:    int | None  = Field(None)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def _graph_is_consistent(self) -> "Process":
        """Every Stream must connect an existing OUT Port to an existing IN Port,
        with a carrier that matches both Ports."""
        units_by_id = {u.id: u for u in self.units}
        if len(units_by_id) != len(self.units):
            raise ValueError("duplicate Unit id in Process.")

        def _port(endpoint: Endpoint, expected: PortDirection) -> Port:
            unit = units_by_id.get(endpoint.unit_id)
            if unit is None:
                raise ValueError(f"Stream references unknown Unit '{endpoint.unit_id}'.")
            port = next((p for p in unit.ports if p.id == endpoint.port_id), None)
            if port is None:
                raise ValueError(
                    f"Unit '{endpoint.unit_id}' has no Port '{endpoint.port_id}'.")
            if port.direction != expected:
                raise ValueError(
                    f"Port '{endpoint.unit_id}.{endpoint.port_id}' must be an "
                    f"{expected.value} port for this Stream end.")
            return port

        seen: set[str] = set()
        for stream in self.streams:
            if stream.id in seen:
                raise ValueError(f"duplicate Stream id '{stream.id}'.")
            seen.add(stream.id)
            src = _port(stream.source, PortDirection.OUT)
            dst = _port(stream.target, PortDirection.IN)
            if not (stream.carrier == src.carrier == dst.carrier):
                raise ValueError(
                    f"Stream '{stream.id}' carrier '{stream.carrier.value}' does not "
                    f"match its Ports ({src.carrier.value} → {dst.carrier.value}).")
        return self


# ---------------------------------------------------------------------------
# List-view response models
# ---------------------------------------------------------------------------

class ProcessSummary(BaseModel):
    """Lightweight Process summary for list endpoints."""
    id:          UUID
    slug:        str
    name:        str
    description: str | None = None
    domain:      str | None = None
    status:      ProcessStatus
    n_units:     int = Field(0, description="Number of Units in the Process.")
    n_streams:   int = Field(0, description="Number of Streams in the Process.")
    carriers:    list[EnergyCarrier] = Field(
        default_factory=list, description="Distinct carriers used across the Process's Streams.")
    tags:        list[str] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ProcessCatalogue(BaseModel):
    """Top-level Process list response."""
    total:     int
    processes: list[ProcessSummary]
    has_more:  bool = Field(False)
