# Contributing

Use Node **24.9+** (24 LTS recommended) and npm 10+ for development. The library
runtime also supports Node 22.12+; Jest's NestJS 12 ESM support needs newer Node.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run check:package
npm run test:package
npm run audit:dependencies
# All of the above:
npm run validate
```

Tests use SQLite in memory and an ephemeral localhost HTTP port. No database
server, Redis service or credentials are required. `sqlite3` is a native test
dependency: npm installs its prebuilt binary, or needs native build tools if no
binary exists for your platform. npm 12 uses the pinned `allowScripts` approval
for `sqlite3@6.0.1` in package.json; review and update that approval when changing
the driver version. Other dependency install scripts are unnecessary for these
tests. `test:package` needs registry access to install
an independent consumer and audit its peers. CI runs NestJS 11 and 12 on Node 24
and 26, plus a Node 22.12 consumer test and Windows coverage.

Keep public exports in `src/index.ts`, preserve the HTTP/query contract and add
regression tests for behavior changes. Do not commit `dist`, tarballs, `.env`,
tokens or generated graph artifacts. Examples remain in `src/example` and are
excluded from the package. Update README and CHANGELOG with public changes.

## Releases

Release publication is **local only**, never automatic in CI. The executable
contract is `scripts/release.mjs`. Before starting:

1. Review the change notes and choose the appropriate SemVer increment.
2. Commit all intended changes on `main`; synchronize it with `origin/main`.
3. Authenticate with `npm login --registry=https://registry.npmjs.org/` using an
   account authorized to publish under `@charlietyn/`. Enable npm 2FA. Never put
   credentials in this repository.
4. Run a dry run, then invoke the chosen release explicitly:

```sh
npm run release -- --dry-run
npm run release                 # default: patch
npm run release -- patch
npm run release -- minor
npm run release -- major
npm run release -- minor --dry-run
```

For the current `1.0.0`, those increments produce `1.0.1`, `1.1.0`, or `2.0.0`.
The script reads the actual version; examples are not hardcoded into it. Patch
means compatible fixes, minor compatible features, major incompatible changes.
The scoped package is a new identity; older unscoped users must change imports
and meet the new peer/runtime requirements.

Every mode requires a clean working tree and `main`. Dry run executes validation,
build, tests, package inspection, consumer installation and registry version
checks. It does **not** change versions, create commits/tags, publish or push.
Build output and temporary test files can be created. It does not require npm
login or test Git push permissions.

A real release additionally checks npm identity, remote synchronization, local
and remote tag absence and a Git push dry run. Only then does it update package
and lockfile versions, create the release commit/tag, pack and publish the
inspected tarball, and atomically push that commit and its tag. No other tags are
pushed. `npm publish` from the source tree is blocked by `prepublishOnly`; deliberate
`--ignore-scripts` bypasses npm lifecycle hooks and must not be used manually.

If validation/authentication fails, versions remain unchanged. If npm publishing
fails after the commit, inspect npm and the local commit/tag; the script never
retries or resets Git automatically. A network failure may have occurred after
the registry accepted the tarball. If publishing succeeds but pushing fails, the
message explicitly says **already published** and gives the exact recovery push.
Do not rerun release to repair a push: that would propose a new version.

## OIDC decision

[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) is a good
future replacement for local authentication, but is not enabled here. There is
one publisher: the local release command. CI has only `contents: read`, no npm
token, no `id-token: write` and no publishing job. A future OIDC migration must
replace local publishing, configure the exact repository/workflow/environment in
npm, and use the npm/Node versions required by npm's documentation. Do not add a
second publisher racing the local script.
