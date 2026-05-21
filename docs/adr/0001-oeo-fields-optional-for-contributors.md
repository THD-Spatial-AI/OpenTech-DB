# OEO fields are optional for contributors; validated at review time

Contributors submitting data do not need to provide `oeo_class` or `oeo_uri`. These fields are validated and completed by a maintainer during the approval review before the Submission is merged into the catalogue.

The alternative — requiring OEO fields in the contributor form — was rejected because most energy researchers are unfamiliar with the Open Energy Ontology namespace and would be blocked before entering any useful data. The value of OEO alignment is in the catalogue being consistent, not in contributors doing the lookup themselves. Maintainers are better positioned to validate ontology mappings in bulk during review.

**Consequence:** every approved Submission must be checked by a maintainer for OEO completeness before merge. A Submission cannot be auto-approved.
