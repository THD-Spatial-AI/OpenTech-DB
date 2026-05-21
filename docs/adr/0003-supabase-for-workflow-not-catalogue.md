# Supabase stores workflow state only — not a catalogue mirror

The Supabase PostgreSQL database is used exclusively for transient workflow
records: Candidate and Submission review queues, scraper run logs, and
authentication. It is **not** a mirror of the technology catalogue.

The authoritative store for Technology, Instance, and Parameter data is the
JSON catalogue under `data/`. That store is version-controlled, diff-able, and
portable — no external account is needed to read or contribute to it.

Migration 002 created `technologies` and `technology_instances` tables that
were never written to. Migration 004 drops them. Future contributors should
not re-add Supabase tables for catalogue data.

**Why:** A SQL mirror of the catalogue would introduce a second source of truth
with no clear sync boundary. Any divergence between the JSON files and the
database would be silent and hard to detect. The JSON store already satisfies
all read requirements (served via FastAPI with an LRU cache); the operational
benefits of a SQL catalogue mirror do not outweigh the consistency risk.

**Consequence:** Adding or editing Technologies and Instances always means
editing JSON files in `data/` (directly or via a GitHub PR triggered by the
Approval workflow). Supabase is never the destination for catalogue writes.
