"""
scrapers/cli.py
================
Command-line interface for the OpenTech-DB scraper.

Usage
-----
    python -m scrapers.cli run
    python -m scrapers.cli run --tech ccgt --tech solar_pv_utility
    python -m scrapers.cli run --source open_alex --source nrel_atb
    python -m scrapers.cli status
    python -m scrapers.cli candidates list
    python -m scrapers.cli candidates list --tech ccgt
    python -m scrapers.cli candidates approve <candidate_id>
    python -m scrapers.cli candidates reject  <candidate_id> --reason "..."
    python -m scrapers.cli sources

Requires `click` (pip install click).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import click
except ImportError:
    print(
        "ERROR: `click` is not installed. Run `pip install click` to use the CLI.",
        file=sys.stderr,
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# Entry point group
# ---------------------------------------------------------------------------

@click.group()
def cli() -> None:
    """OpenTech-DB scraping pipeline CLI."""


# ---------------------------------------------------------------------------
# run
# ---------------------------------------------------------------------------

@cli.command()
@click.option(
    "--tech", "-t", "tech_ids",
    multiple=True, metavar="TECH_ID",
    help="Limit run to specific technology IDs (repeatable).",
)
@click.option(
    "--source", "-s", "sources",
    multiple=True, metavar="SOURCE",
    help="Limit run to specific sources (repeatable).",
)
@click.option("--config", "-c", default=None, type=click.Path(), help="Path to scraper_config.yaml.")
def run(tech_ids: tuple, sources: tuple, config: str | None) -> None:
    """Execute the scraping pipeline (or a subset of it)."""
    from scrapers.pipeline import ScrapingPipeline

    config_path = Path(config) if config else None
    pipeline = ScrapingPipeline.from_config(config_path)

    click.echo("Starting pipeline run…")
    result = pipeline.run(
        tech_ids=list(tech_ids) or None,
        sources=list(sources) or None,
    )

    click.echo(
        click.style("\n✓ Pipeline run complete", fg="green")
        if not result.errors
        else click.style("\n⚠ Pipeline run complete with errors", fg="yellow")
    )
    click.echo(f"  Technologies processed : {result.technologies_processed}")
    click.echo(f"  Papers fetched         : {result.papers_fetched}")
    click.echo(f"  Candidates created     : {result.candidates_created}")

    if result.errors:
        click.echo(click.style(f"  Errors ({len(result.errors)}):", fg="yellow"))
        for e in result.errors[:10]:
            click.echo(f"    • {e}")


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

@cli.command()
@click.option("--config", "-c", default=None, type=click.Path(), help="Path to scraper_config.yaml.")
def status(config: str | None) -> None:
    """Show pipeline status: last run, pending candidates, scheduler jobs."""
    from scrapers.config import ScraperConfig
    from scrapers.storage import CandidateStore

    config_path = Path(config) if config else None
    cfg = ScraperConfig.load(config_path)

    base_dir = cfg.resolved_path(getattr(cfg.output, "base_dir", "data/scraped"))
    store    = CandidateStore(base_dir)

    click.echo(click.style("=== OpenTech-DB Scraper Status ===", bold=True))

    # Candidate counts
    counts = store.count_by_status()
    click.echo(f"\nCandidates:")
    click.echo(f"  Pending  : {counts['pending']}")
    click.echo(f"  Approved : {counts['approved']}")
    click.echo(f"  Rejected : {counts['rejected']}")

    # Last run
    last = store.last_run()
    if last:
        click.echo(f"\nLast run:")
        click.echo(f"  Started    : {last.get('started_at', 'N/A')}")
        click.echo(f"  Finished   : {last.get('finished_at', 'N/A')}")
        click.echo(f"  Candidates : {last.get('candidates_created', 0)}")
        errs = last.get('errors', [])
        if errs:
            click.echo(click.style(f"  Errors     : {len(errs)}", fg="yellow"))
    else:
        click.echo("\nNo runs recorded yet.")

    # Enabled sources
    click.echo(f"\nEnabled sources: {', '.join(cfg.enabled_sources) or 'none'}")


# ---------------------------------------------------------------------------
# candidates sub-group
# ---------------------------------------------------------------------------

@cli.group()
def candidates() -> None:
    """Review, approve, or reject scraper candidates."""


@candidates.command("list")
@click.option("--tech", "-t", default=None, help="Filter by technology_id.")
@click.option(
    "--status", "status_filter",
    type=click.Choice(["pending", "approved", "rejected"]),
    default="pending", show_default=True,
)
@click.option("--limit", "-n", default=20, show_default=True, help="Max results to show.")
@click.option("--json-out", is_flag=True, help="Print full JSON output.")
@click.option("--config", "-c", default=None, type=click.Path())
def list_candidates(
    tech: str | None, status_filter: str, limit: int, json_out: bool, config: str | None
) -> None:
    """List scraper candidates."""
    from scrapers.config import ScraperConfig
    from scrapers.storage import CandidateStore, CandidateStatus

    cfg   = ScraperConfig.load(Path(config) if config else None)
    store = CandidateStore(cfg.resolved_path(getattr(cfg.output, "base_dir", "data/scraped")))
    items = store.list_candidates(
        status=CandidateStatus(status_filter),
        technology_id=tech,
        limit=limit,
    )

    if json_out:
        click.echo(json.dumps(items, indent=2, ensure_ascii=False, default=str))
        return

    if not items:
        click.echo("No candidates found.")
        return

    for item in items:
        params = item.get("extracted_params", {})
        param_summary = ", ".join(
            f"{k}={v['value']:.1f}" for k, v in params.items() if "value" in v
        )
        click.echo(
            f"[{item['status'][:3].upper()}] {item['candidate_id'][:8]}  "
            f"tech={item.get('technology_id')}  "
            f"src={item.get('source')}  "
            f"year={item.get('paper_year')}  "
            f"params=({param_summary})"
        )
        click.echo(
            f"         title: {(item.get('paper_title') or '')[:70]}"
        )


@candidates.command("show")
@click.argument("candidate_id")
@click.option("--config", "-c", default=None, type=click.Path())
def show_candidate(candidate_id: str, config: str | None) -> None:
    """Show full details of a candidate."""
    from scrapers.config import ScraperConfig
    from scrapers.storage import CandidateStore

    cfg   = ScraperConfig.load(Path(config) if config else None)
    store = CandidateStore(cfg.resolved_path(getattr(cfg.output, "base_dir", "data/scraped")))
    item  = store.get_candidate(candidate_id)
    if item is None:
        click.echo(click.style(f"Candidate '{candidate_id}' not found.", fg="red"))
        sys.exit(1)
    click.echo(json.dumps(item, indent=2, ensure_ascii=False, default=str))


@candidates.command("approve")
@click.argument("candidate_id")
@click.option("--notes", "-n", default="", help="Review notes.")
@click.option("--reviewer", "-r", default=None, help="Reviewer name.")
@click.option("--config", "-c", default=None, type=click.Path())
def approve_candidate(
    candidate_id: str, notes: str, reviewer: str | None, config: str | None
) -> None:
    """Approve a candidate and merge its instance into the catalogue."""
    from scrapers.pipeline import ScrapingPipeline
    from scrapers.config import ScraperConfig

    cfg      = ScraperConfig.load(Path(config) if config else None)
    pipeline = ScrapingPipeline(cfg)
    updated  = pipeline.approve_candidate(candidate_id, reviewed_by=reviewer, notes=notes)
    if updated is None:
        click.echo(click.style(f"Candidate '{candidate_id}' not found.", fg="red"))
        sys.exit(1)
    click.echo(
        click.style(f"✓ Candidate {candidate_id[:8]} approved and merged.", fg="green")
    )


@candidates.command("reject")
@click.argument("candidate_id")
@click.option("--reason", "-r", default="", help="Reason for rejection.")
@click.option("--reviewer", default=None, help="Reviewer name.")
@click.option("--config", "-c", default=None, type=click.Path())
def reject_candidate(
    candidate_id: str, reason: str, reviewer: str | None, config: str | None
) -> None:
    """Reject a candidate."""
    from scrapers.config import ScraperConfig
    from scrapers.storage import CandidateStore, CandidateStatus

    cfg   = ScraperConfig.load(Path(config) if config else None)
    store = CandidateStore(cfg.resolved_path(getattr(cfg.output, "base_dir", "data/scraped")))
    updated = store.update_status(
        candidate_id,
        CandidateStatus.REJECTED,
        review_notes=reason,
        reviewed_by=reviewer,
    )
    if updated is None:
        click.echo(click.style(f"Candidate '{candidate_id}' not found.", fg="red"))
        sys.exit(1)
    click.echo(click.style(f"✓ Candidate {candidate_id[:8]} rejected.", fg="yellow"))


# ---------------------------------------------------------------------------
# sources
# ---------------------------------------------------------------------------

@cli.command()
@click.option("--config", "-c", default=None, type=click.Path())
def sources(config: str | None) -> None:
    """List configured scraping sources and their status."""
    from scrapers.config import ScraperConfig

    cfg = ScraperConfig.load(Path(config) if config else None)

    click.echo(click.style("Configured sources:", bold=True))
    all_sources = ("open_alex", "semantic_scholar", "scopus", "google_scholar", "nrel_atb", "irena")
    for name in all_sources:
        src_cfg = getattr(cfg.sources, name, None)
        enabled = getattr(src_cfg, "enabled", False)
        colour  = "green" if enabled else "red"
        status_str = "ENABLED" if enabled else "disabled"
        desc = getattr(src_cfg, "description", "")
        click.echo(
            f"  {click.style(status_str, fg=colour):<18}  {name:<25}  {desc[:60]}"
        )


# ---------------------------------------------------------------------------
# Module entry point
# ---------------------------------------------------------------------------

def main() -> None:  # noqa: D401
    cli()


if __name__ == "__main__":
    main()
