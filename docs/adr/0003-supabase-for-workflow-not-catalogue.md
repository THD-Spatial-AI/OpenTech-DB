# Superseded: Supabase stores workflow state only

The original decision limited Supabase to workflow records and made JSON files
the only catalogue store. It was superseded when the `technologies`,
`technology_instances`, and time-series tables became the primary runtime data
source, with repository JSON retained as seeds and a local fallback.

The current boundary is:

- Supabase PostgreSQL/PostgREST stores catalogue, time-series, scraper,
  submission data, and hashed personal API-token metadata.
- All Supabase access is performed server-side with the service-role key.
- Supabase Auth/GoTrue is disabled and no Supabase user record is created.
- Keycloak owns users and roles. Workflow rows may store an immutable Keycloak
  subject and email as denormalized attribution, without a user-table foreign
  key.
- Approved catalogue changes can still be represented by a GitHub pull request
  so the repository seed data remains reviewable and portable.
