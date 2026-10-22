# Security

## Reporting

Use the repository's GitHub **Security → Report a vulnerability** feature when
available. If private reporting is not enabled, contact the repository maintainer
privately through their GitHub profile before sharing details. Never put tokens,
customer data or an exploitable proof of concept in a public issue.

## Package and release controls

The npm allowlist contains compiled JavaScript/declarations, package metadata,
README, CHANGELOG and the existing MIT license. Source examples, tests, scripts,
environment files and graph artifacts are excluded. `check:package` rejects
unexpected files, missing entry points and common credential signatures; this is
a useful gate, not proof that every possible secret pattern is detectable.

Release requires a clean `main`, validation, an unused version/tag, npm identity
and a synchronized remote. No credentials are embedded in code or workflows.
GitHub CI does not publish. Protect `main` and review dependency lockfile changes.

## Application boundaries

- Configure authentication and tenant authorization in the consuming application.
  `RolesGuard` reads `request.user`; it does not authenticate users.
- `FIELDS_BY_ROLE` restricts top-level CRUD writes, not reads. Use DTOs/serializers
  and explicit authorization for sensitive outputs and custom relation payloads.
- The base controller accepts generic records. DTO validation is **not** automatic;
  consumers must provide concrete DTOs/pipes or override handlers. The default
  `actionValidate` hook returns success until a consumer implements business rules.
- Relation mutation rows are scoped to the parent. A many-to-many pivot must share
  the related model's connection for compound writes; this is not a distributed
  transaction implementation.
- Review database error details before exposing responses outside a trusted API;
  the existing parser can include driver details. Use an exception filter to redact
  them when needed.

## Dependencies

Run `npm run audit:dependencies` and `npm run test:package` before releasing. The
latter audits a real consumer, including runtime peer dependencies. High/critical
advisories fail validation. Moderate transitive advisories are reported and must
be reviewed; the project does not apply arbitrary major overrides to Sequelize
or Jest to silence them. See `docs/PACKAGE-AUDIT.md` for the preparation audit and
compatibility limits.
