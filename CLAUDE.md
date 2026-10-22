# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A publishable NestJS library (`nest-rest-generic-sequelize`) providing generic
base classes — **Model / Service / Controller** — for building advanced REST CRUD
APIs over `sequelize-typescript`. It is a TypeScript port of the Laravel package
`rest-generic-class` and intentionally preserves its HTTP contract, query grammar,
and snake_case method names (camelCase aliases are added alongside).

The consumer-facing contract (query language, endpoints, config keys, caching) is
documented in `README.md`. Read it before changing public behavior — the parity
with the Laravel original is a deliberate constraint, not an accident.

## Commands

```bash
npm run build        # tsc -p tsconfig.build.json → dist/ (the published artifact)
npm test             # jest, in-memory SQLite integration tests
npm run test:cov     # jest with coverage
npm run lint         # eslint "src/**/*.ts" --fix
npx jest test/base-service.spec.ts                 # run a single spec file
npx jest -t "applies relation filter as whereHas"  # run tests matching a name
```

Tests use a real in-memory SQLite database (`sqlite3` dev dep), not mocks — they
boot actual Sequelize models and assert on query results. Specs live in `test/`
(not `src/`), matched by `.*\.spec\.ts$`.

## Architecture

Request flow (also in README "Architecture"):

```
HTTP ─▶ RestController ─▶ BaseService ─▶ SequelizeQueryTranslator ─▶ Model ─▶ DB
            │                  │
            │                  ├── RgcCacheService   (versioned cache)
            │                  ├── HierarchyEngine   (adjacency-list trees)
            │                  └── sequelize.transaction (every write)
            └── DatabaseErrorParser (friendly DB errors)
```

The three layers a consumer extends, and the static "convention constants" that
drive behavior, all live in `src/base/`:

- **`base.model.ts`** — `BaseModel` declares the static contract every model opts
  into: `MODEL` (cache/bulk key), `RELATIONS` (the security whitelist of
  loadable/filterable associations), `HIERARCHY_FIELD_ID`, `CACHE_INVALIDATES`,
  `FIELD_KEY_UPDATE`, `FIELDS_BY_ROLE`. `getStatic()` reads these off any model
  class with a fallback — this is how the generic layers stay model-agnostic.
- **`base.service.ts`** — `BaseService<M>` is the brain. Read methods
  (`list_all`, `get_one`, `show`) are cache-aware; write methods (`create`,
  `update`, `update_multiple`, `destroy`, `destroybyid`) run inside
  `sequelize.transaction` and call `bumpCache()` on success. `create` detects bulk
  shape via `params[MODEL]` being an array.
- **`rest.controller.ts`** — `RestController<M>` declares the inherited route
  decorators. `process_request()` merges `req.query` + `req.body` into the
  universal `FilterParams`. Field-level write restriction is applied here before
  the body reaches the service (`applyFieldRestriction` / `stripForUser`).

### The query engine (`src/query/`)

`SequelizeQueryTranslator.buildFindOptions()` turns `FilterParams` into Sequelize
`FindOptions`. Key design points to preserve:

- `oper` is translated **directly** to a `where` tree using Sequelize `Op`
  symbols (`Op.and`/`Op.or`/`Op.eq`/…). No DNF/normalization step — arbitrary
  AND/OR nesting maps natively. Leaf condition strings are `"field|operator|value"`.
- Any **non-`and`/`or` object key inside `oper` is a relation filter** (the
  `whereHas` analogue). `collectRelationFilters()` harvests these by path; they
  become `include` entries with `required: true`.
- The `relations` param produces `include` entries (eager load + attribute
  selection, `required: false`). Both kinds of include are merged into one tree by
  `mergePath()` keyed on association alias, so a relation that is both eager-loaded
  and filtered yields a single include node.
- Field names containing `.` become Sequelize nested-column refs (`$rel.col$`).
- `condition.parser.ts` / `relations.parser.ts` handle string parsing, JSON
  decoding (`maybeJson`), value coercion, and relation `rel:f1,f2` field syntax.
- Relations not in the model's `RELATIONS` whitelist throw when
  `filtering.strictRelations` is on (the default). This is a security boundary.

### Relations / polyglot persistence (`src/relations/`)
`RelationManager` drives O2M/M2M CRUD purely from the resolved relation config. Because every `ModelStatic` already carries its own Sequelize instance, related/pivot **reads and writes go through `config.relatedModel`/`config.pivotModel` directly** — so they already hit that model's own connection even when it differs from the parent's. The one cross-connection fix is the **transaction**: `tx(model, work)` now opens the transaction on the **written model's** Sequelize instance (related for create/update/delete, pivot for attach/detach/updatePivot), never the parent's — passing the parent's transaction to a model on another instance would throw. The pivot is assumed to share the related model's connection. With a single connection every model shares one instance, so behaviour is unchanged. Covered by `test/cross-connection.spec.ts`.

**Parent scoping is a security invariant**: every read and write resolves rows
*within the parent of the route*, never by related PK alone — O2M scopes on
`foreignKey = localKeyValue(parent)`, M2M on the pivot link (`isLinked` /
`linkedIds`). This holds on the **bulk** paths as well as the single-record ones;
ids outside the relation come back in `error.not_found_ids` rather than being
mutated. Covered by `test/relation-scoping.spec.ts`. Relation writes go through
`BaseService.bumpRelationCache()`, which bumps both the parent and the related
model version (`test/cache-invalidation.spec.ts`).

### Caching (`src/cache/cache.service.ts`)

Versioned/logical invalidation — there is **no key scanning**. Each model has a
version counter in the store; writes call `bumpVersion()`, which is folded into the
cache key so old entries are simply orphaned. The store interface (`RgcCacheStore`:
`get/set/del`) is fully **async** so out-of-process backends (Redis via
`CacheManagerStore`) invalidate correctly across processes. TTLs are in **seconds**
internally; `CacheManagerStore` bridges to cache-manager's milliseconds.

### Other pieces

- `src/hierarchy/hierarchy.engine.ts` — builds adjacency-list trees from flat rows
  in memory; 5 filter modes (`match_only`, `with_ancestors`, `with_descendants`,
  `full_branch`, `root_filter`).
- `src/security/` — `RolesGuard` + `@Roles()` for endpoint protection;
  `field-access.ts` for `FIELDS_BY_ROLE` write stripping. `is_superuser` bypasses
  checks. Roles read from `request.user` in several shapes.
- `src/export/export.service.ts` — Excel/PDF generation. `exceljs` and `pdfkit`
  are **optional peer deps**; import them lazily so the library works without them.
- `src/errors/database-error-parser.ts` — maps PostgreSQL/MySQL/Sequelize typed
  errors to friendly NestJS exceptions. Every controller action wraps calls in
  `try/catch` → `DatabaseErrorParser.handle(e)`.
- `src/module/generic-rest.module.ts` — `GenericRestModule.forRoot()` is `@Global`,
  provides the merged `RestGenericConfig` and `RgcCacheService` via DI.
- `src/example/` — a complete Product/Category reference implementation; also the
  fixtures the test suite builds on.

## Conventions when extending

- **Everything public must be re-exported from `src/index.ts`** (the barrel). The
  published API is whatever this file exports.
- Keep the Laravel parity: when adding a service method, retain the snake_case name
  and add a camelCase alias (see `listAll`/`list_all`, `updateMultiple`).
- New behavior keyed off a model should use a `static` convention constant on
  `BaseModel` read via `getStatic()`, rather than requiring subclasses to override
  methods.
- Optional dependencies (`exceljs`, `pdfkit`, `cache-manager`) must stay optional —
  guard their use behind lazy imports and `peerDependenciesMeta.optional`.
- `dist/` is the published output (`main`/`types` point there); never edit it by
  hand and don't commit ad-hoc files into it.
