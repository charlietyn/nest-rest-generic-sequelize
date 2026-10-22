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

Run `npm run audit:dependencies`, `npm run test:dependencies` and
`npm run test:package` before releasing. Repository and mitigated consumer audits
reject every reported vulnerability, including moderate and low severity.
Transport errors and malformed audit responses also fail validation. JSON reports
are retained under `.artifacts/audit/` and uploaded by CI even when checks fail.

The repository pins `uuid@11.1.1` under Sequelize/ExcelJS and `js-yaml@4.3.2`
under `@istanbuljs/load-nyc-config`. Compatibility tests cover UUID v1/v4 defaults,
transaction commit/rollback, v3/v5/v6 buffer bounds, Excel extended conditional
formatting, and YAML configuration inheritance. Coverage runs exercise Jest.

Consumers must configure the UUID overrides in their own root manifest, as shown
in README. Published library overrides are not inherited. A separate unmitigated
consumer probe reports only the known moderate
[UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) and its transitive
dependents; any other advisory or severity escalation fails. This probe is
upstream monitoring, not evidence of a clean default installation. Both supported
consumer configurations (without and with optional exports) must audit clean.

Review upstream adoption weekly through CI/Dependabot. Remove each override only
after an upstream update passes the same compatibility and consumer audits without
it. Until then, downstream root configuration remains required. See
`docs/PACKAGE-AUDIT.md` for the preparation audit and compatibility limits.
