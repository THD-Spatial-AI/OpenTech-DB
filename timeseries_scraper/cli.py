"""CLI entry point: python -m timeseries_scraper.cli run [options]"""
from __future__ import annotations
import argparse
import logging
import sys

from . import pipeline
from .sources.pvgis import LOCATIONS


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    p = argparse.ArgumentParser(description="OpenTech-DB timeseries acquisition pipeline")
    sub = p.add_subparsers(dest="command")

    run_p = sub.add_parser("run", help="Fetch and write timeseries profiles")
    run_p.add_argument("--source", action="append", dest="sources", metavar="NAME",
                       help="Source(s) to run (pvgis, open_meteo_wind, open_meteo_wind_cf, open_meteo_solar). Default: all.")
    run_p.add_argument("--location", action="append", dest="locations", metavar="CODE",
                       help="ISO country code(s) to fetch. Default: all 30 countries.")
    run_p.add_argument("--year", type=int, action="append", dest="years", metavar="YYYY",
                       help="Year(s) to fetch. Default: 2019–2023.")
    run_p.add_argument("--dry-run", action="store_true",
                       help="Log what would be written without writing files.")
    run_p.add_argument("--approve", action="store_true",
                       help="Immediately approve all written submissions into the catalogue.")

    sub.add_parser("list-locations", help="Print available location codes")

    args = p.parse_args()

    if args.command == "run":
        result = pipeline.run(
            sources=args.sources,
            locations=args.locations,
            years=args.years,
            dry_run=args.dry_run,
            auto_approve=args.approve,
        )
        print(f"\n{'DRY RUN ' if args.dry_run else ''}Results:")
        print(f"  Written  : {result.written}")
        print(f"  Approved : {result.approved}")
        print(f"  Skipped  : {result.skipped}")
        print(f"  Errors   : {result.errors}")
        if result.warnings:
            print(f"  Warnings : {len(result.warnings)}")
            for w in result.warnings[:10]:
                print(f"    {w}")
        sys.exit(0 if result.errors == 0 else 1)

    elif args.command == "list-locations":
        for code in sorted(LOCATIONS):
            lat, lon = LOCATIONS[code]
            print(f"  {code}  lat={lat}, lon={lon}")

    else:
        p.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
