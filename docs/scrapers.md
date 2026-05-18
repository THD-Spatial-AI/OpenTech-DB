# Scraper Pipeline

OpenTech-DB includes an **automated data acquisition pipeline** that searches academic databases and grey-literature sources for energy technology parameters, extracts structured values, and queues them as *candidates* for admin review before merging into the main catalogue.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ScrapingPipeline.run()                          │
│                                                                     │
│  ┌────────────────┐    ┌─────────────────┐    ┌─────────────────┐  │
│  │   Sources      │───▶│   Extractors    │───▶│   Normalizer    │  │
│  │  (scrapers/)   │    │  text / PDF     │    │  → candidates   │  │
│  │  OpenAlex      │    │  LLM (optional) │    │  flat schema    │  │
│  │  Sem. Scholar  │    └─────────────────┘    └────────┬────────┘  │
│  │  NREL ATB      │                                    │           │
│  │  Crossref      │              ┌─────────────────────▼─────────┐ │
│  │  arXiv …       │              │         Storage               │ │
│  └────────────────┘              │  Supabase (primary)           │ │
│                                  │  File fallback (data/scraped/) │ │
│                                  └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

The pipeline is orchestrated by **APScheduler** and runs automatically twice per month (1st and 15th at 02:00 UTC). It can also be triggered manually via the admin API or CLI.

---

## Components

### `ScrapingPipeline` (`scrapers/pipeline.py`)

Central orchestrator that:

1. Loads `ScraperConfig` from `scraper_config.yaml`.
2. Instantiates enabled source scrapers.
3. For each enabled technology × source combination, fetches `PaperRecord` objects.
4. Passes papers through `TextExtractor` (and optionally `PDFExtractor` + `LLMExtractor`).
5. Runs `Normalizer` to build candidate instances.
6. Writes candidates to `Storage`.
7. Emits live run events consumed by the `/scraper/status` endpoint.

**Starting a run:**

```python
from scrapers.pipeline import ScrapingPipeline

pipeline = ScrapingPipeline.from_config()

# Full run — all sources × all technologies
result = pipeline.run()

# Selective run — only specified technologies
result = pipeline.run(tech_ids=["ccgt", "solar_pv_utility"])

# Selective run — only specified sources
result = pipeline.run(sources=["open_alex", "nrel_atb"])
```

---

### `BaseScraper` (`scrapers/base.py`)

Abstract base class shared by all source scrapers. Provides:

- **HTTP client** — `httpx.AsyncClient` with configurable `timeout_seconds` and `max_retries`.
- **Rate limiting** — configurable `rate_limit_delay` (default 1.5 s) between requests.
- **Disk cache** — optional HTTP response cache with `cache_ttl_hours` (default 24 h). Avoids redundant API calls on repeated runs.
- **Exponential back-off** — on HTTP 429 / 503 responses.
- **Robots.txt compliance** — respects crawl delays.
- **Polite User-Agent** — includes `contact_email` from config (required for OpenAlex polite pool: 10 req/s instead of 1 req/s).

---

### Sources (`scrapers/sources/`)

Each source scraper inherits from `BaseScraper` and implements a `search(technology_id, queries)` method returning a list of `PaperRecord` objects.

| Source file | Source | Key details |
|---|---|---|
| `open_alex.py` | **OpenAlex** | 250 M+ scholarly works; free; polite pool 10 req/s |
| `semantic_scholar.py` | **Semantic Scholar** | AI-powered paper search; 200 M+ papers; free |
| `scopus_api.py` | **Elsevier Scopus** | Premium; requires `SCOPUS_API_KEY` + institutional token |
| `scholarly_gs.py` | **Google Scholar** | Web scraping via `scholarly`; fragile; disabled by default |
| `nrel_atb.py` | **NREL ATB** | Annual Technology Baseline; authoritative US cost data |
| `crossref.py` | **Crossref** | DOI metadata; fast free API |
| `arxiv_source.py` | **arXiv** | OAI-PMH + REST; preprints in energy & engineering |
| `europe_pmc.py` | **Europe PMC** | European biomedical + energy papers |

**Enabling/disabling sources** — edit `scraper_config.yaml`:

```yaml
sources:
  open_alex:
    enabled: true
    max_results_per_tech: 20
    lookback_months: 12
  scopus:
    enabled: false           # disabled — requires API key
    api_key: ""
```

---

### Extractors (`scrapers/extractors/`)

After a source returns paper records, extractors parse the text and pull structured parameter values.

#### `TextExtractor` (regex-based)

- Scans paper title, abstract, and full text using technology-specific regex patterns.
- **Parameters it can extract:** `capex`, `opex_fixed`, `opex_var`, `efficiency`, `lifetime`, `co2_emissions`, `capacity`, `degradation_rate`.
- Output: `ExtractedValue` with `value`, `unit`, `context` (surrounding sentence), `confidence` (0–1).
- **Unit conversion**: handles EUR → USD, magnitude words (million, billion, thousand), and common unit variants.

#### `PDFExtractor` (optional, requires `pdfplumber`)

- Downloads open-access PDFs from paper URLs.
- Extracts raw text for downstream processing by `TextExtractor` or `LLMExtractor`.

#### `LLMExtractor` (optional, requires `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`)

- Sends paper abstract / full text to GPT or Claude with a structured extraction prompt.
- Returns `LLMExtractedParams` — a dict of parameter → value with per-field confidence scores.
- **Extraction priority:** LLM > Regex > omit field.

Configure the LLM model in `scraper_config.yaml`:

```yaml
extraction:
  llm_enabled: false          # set true to enable
  llm_model: "gpt-4o-mini"   # or "claude-3-haiku-20240307"
  confidence_threshold: 0.6   # minimum confidence to accept an extracted value
```

---

### `Normalizer` (`scrapers/normalizer.py`)

Converts raw extracted values into a **flat catalogue-format instance dict**:

1. Merges LLM and regex outputs (LLM wins on conflict if confidence > threshold).
2. Builds a deterministic `instance_id` slug.
3. Fills only fields with extracted data — no defaults are invented.
4. Attaches `confidence`, `context`, and `source` to each extracted field.
5. Infers `country_iso2` and `country` from paper text (regex + country name mapping).

Output is a `proposed_instance` dict that matches the flat catalogue schema and can be merged directly into `data/<category>/<category>_technologies.json` without post-processing.

---

### `Storage` (`scrapers/storage.py`)

Persists scraper candidates with deduplication.

**Backend selection:**

| Condition | Backend |
|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set | Supabase `scraper_candidates` + `scraper_runs` tables |
| Environment variables not set | Local files under `data/scraped/candidates/` |

**Candidate statuses:** `pending` → `approved` / `rejected`

**Candidate schema (abbreviated):**

```json
{
  "candidate_id": "uuid4",
  "scraped_at": "2026-05-01T02:13:00Z",
  "status": "pending",
  "technology_id": "ccgt",
  "source": "open_alex",
  "paper_doi": "10.1016/j.energy.2024.01.001",
  "paper_title": "Cost analysis of combined cycle gas turbines in Europe",
  "paper_year": 2024,
  "paper_venue": "Energy",
  "extracted_params": {
    "capex_usd_per_kw": {
      "value": 870.0,
      "unit": "USD/kW",
      "context": "...capital costs of 870 USD/kW were reported...",
      "confidence": 0.91
    }
  },
  "proposed_instance": { ... }
}
```

---

### Scheduler (`scrapers/scheduler.py`)

Wraps **APScheduler** with a SQLite job store (`data/scraped/scheduler.db`) so scheduled runs survive application restarts.

Default schedule (configurable in `scraper_config.yaml`):

```yaml
schedule:
  enabled: true
  jobs:
    - id: "scrape_run_1"
      cron: "0 2 1 * *"     # 1st of month, 02:00 UTC
    - id: "scrape_run_2"
      cron: "0 2 15 * *"    # 15th of month, 02:00 UTC
```

The scheduler is started automatically on FastAPI application startup (lifespan context manager in `main.py`) and stopped on shutdown.

---

## CLI

The scraper can also be invoked from the command line without starting the FastAPI server:

```bash
# Run the full pipeline
python -m scrapers.cli run

# Run only for specific technologies
python -m scrapers.cli run --tech ccgt --tech solar_pv_utility

# Run only specific sources
python -m scrapers.cli run --source open_alex --source nrel_atb

# List candidates by status
python -m scrapers.cli candidates --status pending

# Approve a candidate by ID
python -m scrapers.cli approve <candidate_id>
```

---

## Admin API

The scraper pipeline is managed via the `/scraper` endpoints (admin JWT required). See [API Reference](api-reference.md#scraper-pipeline-admin-only) for full details.

---

## Adding support for a new source

1. Create `scrapers/sources/my_source.py` inheriting from `BaseScraper`.
2. Implement `def search(self, technology_id: str, queries: list[str]) -> list[PaperRecord]`.
3. Register in `scrapers/pipeline.py` `_SOURCE_CLASSES` dict.
4. Add a config block in `scraper_config.yaml` under `sources:`.

```python
# scrapers/sources/my_source.py
from scrapers.base import BaseScraper, PaperRecord

class MySourceScraper(BaseScraper):
    source_name = "my_source"

    def search(self, technology_id: str, queries: list[str]) -> list[PaperRecord]:
        records = []
        for query in queries:
            # ... HTTP call, parse response ...
            records.append(PaperRecord(
                source_name="my_source",
                source_id="unique-id",
                title="...",
                year=2024,
                doi="10.xxxx/...",
                abstract="...",
            ))
        return records
```

---

## Configuration reference

All scraper behaviour is controlled by `scraper_config.yaml`. Key sections:

```yaml
http:
  timeout_seconds: 30
  max_retries: 3
  retry_backoff_seconds: 2.0
  rate_limit_delay: 1.5          # seconds between API calls
  cache_enabled: true
  cache_ttl_hours: 24
  contact_email: opentech-db@th-deg.de  # for OpenAlex polite pool

extraction:
  llm_enabled: false
  llm_model: "gpt-4o-mini"
  confidence_threshold: 0.6

output:
  backend: "supabase"            # or "filesystem"
  filesystem_base: "data/scraped"
```

Technology-specific search queries are configured under `technologies:`:

```yaml
technologies:
  ccgt:
    queries:
      - "combined cycle gas turbine"
      - "CCGT capital cost efficiency"
      - "natural gas combined cycle power plant"
  solar_pv_utility:
    queries:
      - "utility-scale solar PV cost"
      - "photovoltaic CAPEX LCOE"
```
