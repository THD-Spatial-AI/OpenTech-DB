"""
scrapers/extractors/llm_extractor.py
======================================
Optional LLM-based parameter extractor using OpenAI (or Anthropic).

Enabled only when:
  - `extraction.llm.enabled = true` in scraper_config.yaml, AND
  - OPENAI_API_KEY (or ANTHROPIC_API_KEY) environment variable is set.

The LLM receives a truncated snippet of the paper text and returns structured
JSON with cost/performance parameters.  This is more robust than regex for
ambiguous or complex phrasings.

Cost estimate (OpenAI gpt-4o-mini, April 2026):
    ~$0.00015 per 1K input tokens + $0.00060 per 1K output tokens
    A 3000-token paper snippet costs ≈ $0.0005 – negligible at 2×/month runs.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_SYSTEM_PROMPT = """
You are an expert energy systems engineer. Extract cost and performance
parameters from the provided paper excerpt. Return ONLY valid JSON with
the following fields if found in the text, otherwise omit the field:
{
  "capex_usd_per_kw": <number>,
  "opex_fixed_usd_per_kw_yr": <number>,
  "opex_var_usd_per_mwh": <number>,
  "efficiency_percent": <number>,
  "lifetime_years": <number>,
  "co2_emission_factor_g_per_kwh": <number>,
  "typical_capacity_mw": <number>,
  "degradation_rate_percent_per_yr": <number>,
  "rotor_diameter_m": <number>,
  "hub_height_m": <number>,
  "wind_rated_speed_ms": <number>,
  "module_efficiency_fraction": <number between 0 and 1>,
  "performance_ratio": <number between 0 and 1>,
  "solar_multiple": <number>,
  "thermal_storage_h": <number>,
  "optical_efficiency_fraction": <number between 0 and 1>,
  "heat_rate_mj_per_mwh": <number>,
  "min_load_fraction": <number between 0 and 1>,
  "start_up_time_h": <number>,
  "cold_start_time_h": <number>,
  "water_withdrawal_m3_per_mwh": <number>,
  "land_use_m2_per_kw": <number>,
  "roundtrip_efficiency_fraction": <number between 0 and 1>,
  "charge_efficiency_fraction": <number between 0 and 1>,
  "discharge_efficiency_fraction": <number between 0 and 1>,
  "dod_max_fraction": <number between 0 and 1>,
  "cycle_lifetime_cycles": <integer>,
  "loss_rate_pct_per_km": <number>,
  "voltage_kv": <number>,
  "stack_lifetime_h": <number>,
  "cop_heating_at_a7_w35": <number>,
  "notes": "<brief explanation of extracted values>"
}
All monetary values must be in USD. Convert EUR values using 1 EUR = 1.10 USD.
All plain efficiencies must be in % (e.g. 58.5, not 0.585).
module_efficiency_fraction, performance_ratio, charge/discharge/roundtrip efficiencies,
dod_max_fraction, min_load_fraction must be fractions between 0 and 1.
Return ONLY the JSON object, no other text.
""".strip()


@dataclass
class LLMExtractedParams:
    """Structured output from the LLM extractor."""
    capex_usd_per_kw: float | None = None
    opex_fixed_usd_per_kw_yr: float | None = None
    opex_var_usd_per_mwh: float | None = None
    efficiency_percent: float | None = None
    lifetime_years: float | None = None
    co2_emission_factor_g_per_kwh: float | None = None
    typical_capacity_mw: float | None = None
    degradation_rate_percent_per_yr: float | None = None
    # Tech-specific extras
    rotor_diameter_m: float | None = None
    hub_height_m: float | None = None
    wind_rated_speed_ms: float | None = None
    module_efficiency_fraction: float | None = None
    performance_ratio: float | None = None
    solar_multiple: float | None = None
    thermal_storage_h: float | None = None
    optical_efficiency_fraction: float | None = None
    heat_rate_mj_per_mwh: float | None = None
    min_load_fraction: float | None = None
    start_up_time_h: float | None = None
    cold_start_time_h: float | None = None
    water_withdrawal_m3_per_mwh: float | None = None
    land_use_m2_per_kw: float | None = None
    roundtrip_efficiency_fraction: float | None = None
    charge_efficiency_fraction: float | None = None
    discharge_efficiency_fraction: float | None = None
    dod_max_fraction: float | None = None
    cycle_lifetime_cycles: float | None = None
    loss_rate_pct_per_km: float | None = None
    voltage_kv: float | None = None
    stack_lifetime_h: float | None = None
    cop_heating_at_a7_w35: float | None = None
    notes: str = ""
    confidence: float = 0.70   # LLM extractions get a flat confidence score
    raw_response: str = ""


class LLMExtractor:
    """
    Sends paper text to an LLM and asks it to extract structured parameters.

    Usage
    -----
        extractor = LLMExtractor(cfg)
        if extractor.available:
            params = extractor.extract(abstract_text, technology_id="ccgt")
    """

    def __init__(self, cfg: Any) -> None:
        self._cfg = cfg
        llm_cfg = getattr(getattr(cfg, "extraction", None), "llm", None)
        self._enabled   = getattr(llm_cfg, "enabled", False)
        self._provider  = getattr(llm_cfg, "provider", "openai")
        self._model     = getattr(llm_cfg, "model", "gpt-4o-mini")
        self._max_tokens = getattr(llm_cfg, "max_tokens_per_paper", 3000)
        self._temperature = float(getattr(llm_cfg, "temperature", 0.0))
        self._system_prompt = getattr(llm_cfg, "system_prompt", _DEFAULT_SYSTEM_PROMPT)

        self._openai_client: Any = None
        self._anthropic_client: Any = None

        if self._enabled:
            self._init_client()

    def _init_client(self) -> None:
        if self._provider == "openai":
            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                logger.warning("[LLM] OPENAI_API_KEY not set – LLM extraction disabled.")
                self._enabled = False
                return
            try:
                from openai import OpenAI
                self._openai_client = OpenAI(api_key=api_key)
                logger.info("[LLM] OpenAI client initialised (model=%s).", self._model)
            except ImportError:
                logger.warning(
                    "[LLM] `openai` package not installed. "
                    "Run `pip install openai` to enable LLM extraction."
                )
                self._enabled = False

        elif self._provider == "anthropic":
            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not api_key:
                logger.warning("[LLM] ANTHROPIC_API_KEY not set – LLM extraction disabled.")
                self._enabled = False
                return
            try:
                import anthropic
                self._anthropic_client = anthropic.Anthropic(api_key=api_key)
                logger.info("[LLM] Anthropic client initialised (model=%s).", self._model)
            except ImportError:
                logger.warning(
                    "[LLM] `anthropic` package not installed. "
                    "Run `pip install anthropic` to enable LLM extraction."
                )
                self._enabled = False

    @property
    def available(self) -> bool:
        return self._enabled and (
            self._openai_client is not None or self._anthropic_client is not None
        )

    # ------------------------------------------------------------------

    def extract(self, text: str, technology_id: str = "") -> LLMExtractedParams | None:
        """
        Extract parameters from *text* using the configured LLM.
        Returns None if unavailable or the extraction fails.
        """
        if not self.available or not text.strip():
            return None

        # Truncate to keep token cost bounded
        snippet = text[: self._max_tokens * 4]   # rough char estimate

        user_msg = (
            f"Technology: {technology_id}\n\n"
            f"Paper excerpt:\n{snippet}\n\n"
            "Extract cost and performance parameters as JSON."
        )

        try:
            raw = self._call_llm(user_msg)
        except Exception as exc:
            logger.warning("[LLM] API call failed: %s", exc)
            return None

        return self._parse_response(raw)

    # ------------------------------------------------------------------

    def _call_llm(self, user_message: str) -> str:
        if self._openai_client:
            response = self._openai_client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": self._system_prompt},
                    {"role": "user",   "content": user_message},
                ],
                temperature=self._temperature,
                max_tokens=512,
                response_format={"type": "json_object"},
            )
            return response.choices[0].message.content or ""

        if self._anthropic_client:
            response = self._anthropic_client.messages.create(
                model=self._model,
                max_tokens=512,
                system=self._system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
            return response.content[0].text if response.content else ""

        return ""

    def _parse_response(self, raw: str) -> LLMExtractedParams | None:
        raw = raw.strip()
        if not raw:
            return None

        # Strip markdown code fences if present
        raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()

        try:
            data: dict[str, Any] = json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.debug("[LLM] JSON parse error: %s | raw=%r", exc, raw[:200])
            return None

        def _float(key: str) -> float | None:
            v = data.get(key)
            if v is None:
                return None
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        return LLMExtractedParams(
            capex_usd_per_kw=_float("capex_usd_per_kw"),
            opex_fixed_usd_per_kw_yr=_float("opex_fixed_usd_per_kw_yr"),
            opex_var_usd_per_mwh=_float("opex_var_usd_per_mwh"),
            efficiency_percent=_float("efficiency_percent"),
            lifetime_years=_float("lifetime_years"),
            co2_emission_factor_g_per_kwh=_float("co2_emission_factor_g_per_kwh"),
            typical_capacity_mw=_float("typical_capacity_mw"),
            degradation_rate_percent_per_yr=_float("degradation_rate_percent_per_yr"),
            notes=str(data.get("notes", "")),
            raw_response=raw,
        )
