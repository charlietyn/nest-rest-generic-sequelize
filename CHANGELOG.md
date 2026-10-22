# Changelog

## Unreleased

- Mitigate UUID and sprintf-js advisories with scoped, compatibility-tested
  overrides; document the required UUID overrides in consuming applications.
- Reject reported vulnerabilities in repository and mitigated consumer audits,
  retain JSON evidence, and monitor upstream/default consumers separately.
- Test UUID bounds/defaults, transaction rollback, Excel round-trips/conditional
  formatting, Istanbul YAML and optional peer exports; schedule weekly CI checks.
- Check remote synchronization before release validation, including dry runs,
  and recheck afterwards to detect changes during validation.
- Prepare the scoped package `@charlietyn/nest-rest-sequelize`; keep the existing
  `1.0.0` package version until an explicit release is run.
- Support NestJS 12 and 11 with a single CommonJS build consumable from native ESM.
- Add explicit public exports, strict type checking, clean builds, a package
  allowlist, consumer tarball tests, CI and a guarded local release command.
- Fix `GenericRestModule.forRoot` types to accept partial configuration sections.
- Fix `injectParams` for Express 5's getter-only `request.query`.
- Give `Scenario` an explicit Nest 11/12 shared declaration, avoiding leaked
  Nest 12-only types in consumers using Nest 11.
- Keep the existing CRUD/query contract, relation operations and cache behavior.
- Require Node 22.12+ on the 22.x line or Node 24+; use Node 24.9+ for development
  tests with NestJS 12. NestJS 9/10 are outside the supported peer range.
- Add `LICENSE` containing the MIT terms already declared by package.json and
  README; no license change.

No publication is implied by this entry. Before releasing, review the scope and
choose patch, minor or major; move these notes to the resulting version.
