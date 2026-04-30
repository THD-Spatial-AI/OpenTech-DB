"""
scrapers/
=========
Automated data-collection pipeline for OpenTech-DB.

Periodically queries academic databases (OpenAlex, Semantic Scholar, Scopus),
official energy-agency sources (NREL ATB, IRENA), and open-web pages to
discover updated cost/performance parameters for energy technologies.

Key sub-packages
----------------
sources/     — One module per external source (API wrappers + polite HTTP clients).
extractors/  — Extract numeric parameters from abstract text, PDFs, or via LLM.
              text_extractor: regex-based (no external services)
              pdf_extractor:  pdfplumber-based (optional)
              llm_extractor:  OpenAI-based (optional, needs API key)
pipeline.py  — Orchestrates sources → extraction → normalisation → storage.
storage.py   — Reads / writes candidate JSON files in data/scraped/.
normalizer.py— Maps raw extracted values to the OpenTechDB catalogue schema.
scheduler.py — APScheduler job definitions (runs twice a month by default).
cli.py       — Click-based CLI: `python -m scrapers.cli run|status|approve|reject`.
"""
