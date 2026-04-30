"""
scrapers/scheduler.py
======================
APScheduler integration for the OpenTech-DB pipeline.

Runs the scraping pipeline automatically according to the schedule defined
in scraper_config.yaml (default: 1st and 15th of each month at 02:00 UTC).

The scheduler uses a persistent SQLite job store so jobs survive app restarts.

Usage
-----
    from scrapers.scheduler import start_scheduler, stop_scheduler
    # Called once during FastAPI lifespan startup:
    start_scheduler()
    # Called during shutdown:
    stop_scheduler()
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_scheduler = None   # module-level singleton


def _run_pipeline() -> None:
    """Job target – runs inside the APScheduler thread."""
    try:
        from scrapers.pipeline import ScrapingPipeline
        pipeline = ScrapingPipeline.from_config()
        result   = pipeline.run()
        logger.info(
            "Scheduled pipeline run finished: %d candidates created.",
            result.candidates_created,
        )
    except Exception as exc:
        logger.error("Scheduled pipeline run failed: %s", exc, exc_info=True)


def start_scheduler() -> None:
    """
    Initialise and start the APScheduler background scheduler.
    Reads job schedules from scraper_config.yaml.
    Silently no-ops if APScheduler is not installed.
    """
    global _scheduler

    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
        from apscheduler.triggers.cron import CronTrigger
    except ImportError:
        logger.warning(
            "APScheduler not installed – automatic scheduling disabled. "
            "Run `pip install apscheduler sqlalchemy` to enable."
        )
        return

    try:
        from scrapers.config import ScraperConfig
        cfg = ScraperConfig.load()
    except Exception as exc:
        logger.warning("Could not load scraper config for scheduler: %s", exc)
        return

    if not getattr(cfg.schedule, "enabled", False):
        logger.info("Scheduled scraping is disabled in scraper_config.yaml.")
        return

    # Persist jobs so they survive restarts
    project_root = Path(__file__).resolve().parent.parent
    db_url = f"sqlite:///{project_root / 'data' / 'scraped' / 'scheduler.db'}"
    (project_root / "data" / "scraped").mkdir(parents=True, exist_ok=True)

    jobstores = {"default": SQLAlchemyJobStore(url=db_url)}
    _scheduler = BackgroundScheduler(jobstores=jobstores, timezone="UTC")

    jobs_cfg = getattr(cfg.schedule, "jobs", [])
    if not jobs_cfg:
        # Default: 1st and 15th of month at 02:00 UTC
        jobs_cfg = [
            {"id": "scrape_run_1", "cron": "0 2 1 * *"},
            {"id": "scrape_run_2", "cron": "0 2 15 * *"},
        ]

    for job_def in jobs_cfg:
        job_id   = job_def.get("id", "scrape_run")
        cron_str = job_def.get("cron", "0 2 1 * *")
        # Parse cron string: "min hour dom month dow"
        parts = cron_str.split()
        if len(parts) == 5:
            minute, hour, day, month, day_of_week = parts
        else:
            minute, hour, day, month, day_of_week = "0", "2", "1", "*", "*"

        _scheduler.add_job(
            _run_pipeline,
            trigger=CronTrigger(
                minute=minute, hour=hour,
                day=day, month=month,
                day_of_week=day_of_week,
                timezone="UTC",
            ),
            id=job_id,
            name=job_def.get("description", f"Scrape job {job_id}"),
            replace_existing=True,
            misfire_grace_time=3600,   # allow up to 1 h late start
        )
        logger.info("Scheduled scrape job '%s' with cron='%s'", job_id, cron_str)

    _scheduler.start()
    logger.info("Scrape scheduler started.")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scrape scheduler stopped.")
        _scheduler = None


def get_scheduler_status() -> dict:
    """Return a dict describing scheduler state (for the status API endpoint)."""
    if _scheduler is None:
        return {"running": False, "jobs": []}

    jobs = []
    try:
        for job in _scheduler.get_jobs():
            next_run = job.next_run_time
            jobs.append({
                "id":       job.id,
                "name":     job.name,
                "next_run": next_run.isoformat() if next_run else None,
            })
    except Exception:
        pass

    return {"running": _scheduler.running, "jobs": jobs}
