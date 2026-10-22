# @charlietyn/nest-rest-sequelize

> Generic NestJS base classes (**Model / Service / Controller**) for building advanced REST CRUD APIs with **Sequelize** (`sequelize-typescript`).
> TypeScript port of the Laravel package [`rest-generic-class`](https://github.com/charlietyn/rest-generic-class) — same HTTP contract, same feature set.

Build a fully-featured CRUD endpoint (dynamic filtering, eager relations, ordering, pagination, hierarchical trees, transactions, versioned caching and human-friendly DB errors) in **three small files**.

> New to the library? Start with the hands-on onboarding guide (Spanish):
> [`docs/GUIA-JUNIOR.md`](https://github.com/charlietyn/nest-rest-generic-sequelize/blob/main/docs/GUIA-JUNIOR.md).

---

## ✨ Features

| Capability | Supported |
|---|---|
| Dynamic filtering (`oper` AND/OR, nested, relation filters) | ✅ |
| Operators `= != < > <= >= like ilike in between null date regexp …` | ✅ |
| Ordering (`orderby`, dot-notation relations) | ✅ |
| Column projection (`select`) + per-relation field selection (`rel:f1,f2`) | ✅ |
| Eager relations whitelist (`RELATIONS`) + nested (`a.b.c`) | ✅ |
| Offset pagination + cursor / infinite scroll (`infinity`) | ✅ |
| Hierarchical data (adjacency list, 5 filter modes) | ✅ |
| Transactions on every write | ✅ |
| Bulk create / `update_multiple` / `deleteById` | ✅ |
| Versioned cache (vary headers, per-method TTL, relation versions) | ✅ |
| Friendly DB error parsing (PostgreSQL + MySQL + Sequelize typed errors) | ✅ |
| DTO validation in consumer-defined handlers | Configure DTOs/pipes; not automatic |

---

## 📦 Installation

Package name: **`@charlietyn/nest-rest-sequelize`**. This repository preparation
does not publish a version. Until the first explicit release, use `npm pack` and
install the resulting `.tgz` in your application.

```bash
npm install @charlietyn/nest-rest-sequelize
# peer deps (already in a typical Nest + Sequelize project)
npm install @nestjs/common@12 @nestjs/core@12 @nestjs/sequelize@12 sequelize@6 sequelize-typescript@2 reflect-metadata rxjs
# For an existing NestJS 11 app, keep common/core/sequelize integration on @11.
# Also install the Sequelize driver for your database (e.g. pg + pg-hstore).
```

---

## Requirements and compatibility

- NestJS **12 or 11**, with matching `@nestjs/common` and `@nestjs/core` majors.
  Use `@nestjs/sequelize@12` with Nest 12, or `@nestjs/sequelize@11` with Nest 11.
- Sequelize **6.37+**, `sequelize-typescript` **2.1.6+**, RxJS 7.8+ and
  `reflect-metadata` 0.2.2+. The application chooses its database driver.
- Runtime: **Node 22.12+ on 22.x, or Node 24+**. Development and Nest 12 Jest tests:
  **Node 24.9+**. Node 20 and Nest 9/10 are outside this package's supported range.
- TypeScript consumers: 5.9+ recommended, `module` and `moduleResolution` set to
  `NodeNext`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`, and
  `useDefineForClassFields: false` for Sequelize models.

One CommonJS artifact is emitted with declarations. It supports both
`require('@charlietyn/nest-rest-sequelize')` and native ESM named imports from
`'@charlietyn/nest-rest-sequelize'`; it does not start a server or connect to a
database when imported. Internal `dist/*` subpaths are deliberately not exported.
Nest 12's own packages are ESM and rely on modern Node's `require(esm)` when called
from CommonJS. [Nest migration guide](https://docs.nestjs.com/migration-guide).

Tests cover in-memory SQLite. PostgreSQL/MySQL error codes are mapped, but live
PostgreSQL/MySQL integration is not part of this suite. SQL operators such as
`regexp` remain dialect-dependent. Many-to-many compound writes require the pivot
and related model to share a connection; parent models may use another connection.
No distributed transaction is provided. `_nested`, `template` and the distinction
between “only trashed” and “with trashed” are not fully implemented; both non-null
`soft_delete` booleans currently disable Sequelize's paranoid filter.

## 🚀 Quick start (3-file pattern)

### 1. Model — extend `BaseModel`, declare the whitelist

```typescript
import { Table, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { BaseModel } from '@charlietyn/nest-rest-sequelize';
import { Category } from './category.model';

@Table({ tableName: 'products' })
export class Product extends BaseModel {
  static readonly MODEL = 'product';
  static readonly RELATIONS = ['category'] as const; // security whitelist

  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true }) id!: number;
  @Column(DataType.STRING) name!: string;
  @Column(DataType.DECIMAL(10, 2)) price!: number;
  @ForeignKey(() => Category) @Column(DataType.INTEGER) category_id!: number;
  @BelongsTo(() => Category, 'category_id') category!: Category;
}
```

### 2. Service — extend `BaseService<M>`

```typescript
import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BaseService, REST_GENERIC_CONFIG, RestGenericConfig, DEFAULT_CONFIG, RgcCacheService } from '@charlietyn/nest-rest-sequelize';
import { Product } from './product.model';

@Injectable()
export class ProductService extends BaseService<Product> {
  constructor(
    @InjectModel(Product) model: typeof Product,
    @Optional() @Inject(REST_GENERIC_CONFIG) config?: RestGenericConfig,
    @Optional() cache?: RgcCacheService,
  ) {
    super(model, config ?? DEFAULT_CONFIG, cache);
  }
}
```

### 3. Controller — extend `RestController<M>`

```typescript
import { Controller } from '@nestjs/common';
import { RestController } from '@charlietyn/nest-rest-sequelize';
import { Product } from './product.model';
import { ProductService } from './product.service';

@Controller('products')
export class ProductController extends RestController<Product> {
  constructor(service: ProductService) { super(service); }
}
```

### 4. Wire it up

```typescript
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { GenericRestModule } from '@charlietyn/nest-rest-sequelize';
import { Product } from './product.model';
import { Category } from './category.model';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';

@Module({
  imports: [
    SequelizeModule.forRoot({ /* ...dialect, models... */ }),
    GenericRestModule.forRoot({ config: { cache: { enabled: true } } }),
    SequelizeModule.forFeature([Product, Category]),
  ],
  providers: [ProductService],
  controllers: [ProductController],
})
export class AppModule {}
```

Configure `SequelizeModule.forRoot` with your real database options and register
both models shown here. The `Category` model is available in the repository's
`src/example/category.model.ts`. The application owns bootstrap and authentication.
Generic controller bodies are records, so a global `ValidationPipe` alone cannot
infer a concrete DTO. Override write handlers with typed DTOs/pipes as needed;
`class-validator` and `class-transformer` belong to that consuming application.

You now have:

```
GET    /products                 → list (filter/sort/paginate/relations/hierarchy)
GET    /products/get/one         → first matching record
GET    /products/:id             → single record (relations/select)
POST   /products                 → create (single, or bulk via {product:[...]})
PUT    /products/:id             → update
PUT    /products/update/multiple → bulk update
DELETE /products/:id             → delete
DELETE /products/delete/by-id    → delete many ({ids:[...]})
GET    /products/export/data     → export payload (data + columns)
```

---

## 🔎 Query language

### `oper` — dynamic filtering

Conditions are strings `"field|operator|value"` grouped by `and` / `or` blocks. Blocks nest, and any non-logical key is a **relation filter** (the equivalent of Eloquent `whereHas`, implemented as an `include` with `required: true`).

```jsonc
// price >= 50 AND status = active
?oper={"and":["price|>=|50","status|=|active"]}

// name = iPhone OR name = Pixel
?oper={"or":["name|=|iPhone","name|=|Pixel"]}

// nested: active AND (price<100 OR featured=true)
?oper={"and":["status|=|active",{"or":["price|<|100","featured|=|true"]}]}

// relation filter (whereHas): products whose category name is "Phones"
?oper={"category":{"and":["name|=|Phones"]}}&relations=["category"]

// nested relation path
?oper={"user.roles":{"and":["name|=|admin"]}}
```

**Operators:** `=`, `!=`, `<`, `>`, `<=`, `>=`, `like`, `not like`, `ilike`, `not ilike`,
`in`, `not in`, `between`, `not between`, `null`, `not null`, `date`, `not date`, `regexp`, `not regexp`.
Comma-separated values become arrays (`status|in|active,pending`).

Sequelize's `Op` symbols map directly onto the grammar, so arbitrary AND/OR nesting is expressed natively.

### `relations` — eager loading + field selection

```jsonc
?relations=["category"]                      // load association
?relations=["category:id,name"]              // select association attributes
?relations=["user.roles:id,name"]            // nested + fields
?relations=all                               // every whitelisted relation
```

### `orderby`

```jsonc
?orderby=[{"price":"desc"},{"name":"asc"}]
?orderby=[{"category.name":"asc"}]           // order by association field
```

### `select`

```jsonc
?select=["id","name","price"]
```

### `pagination`

```jsonc
?pagination={"page":1,"pageSize":20}                         // offset (findAndCountAll, distinct)
?pagination={"infinity":true,"pageSize":20,"cursor":"123"}  // keyset / infinite scroll
```

### `hierarchy` (adjacency list)

Declare `static HIERARCHY_FIELD_ID = 'parent_id'` on the model.

```jsonc
?hierarchy=true
?hierarchy={"filter_mode":"with_descendants","children_key":"children","max_depth":3}
```

Filter modes: `match_only`, `with_ancestors`, `with_descendants`, `full_branch`, `root_filter`.

---

## 🧠 Caching

Versioned, logical invalidation — no key scanning. Enable via config and (optionally) plug a `cache-manager` store:

```typescript
GenericRestModule.forRoot({
  config: { cache: { enabled: true, ttlByMethod: { list_all: 120 } } },
  cacheStore: myCacheManagerStore, // optional; defaults to in-memory
});
```

- `?cache=false` disables caching for one request.
- `?cache_ttl=300` overrides TTL for one request.
- Every successful write bumps the model's cache version (and any `CACHE_INVALIDATES`).

### Redis (store-agnostic, like Laravel's `Cache::store()`)

The store is fully async, so out-of-process backends like **Redis** invalidate
correctly (the per-model version is read back from the store on every request).
Plug a Redis-backed `cache-manager` store via the bundled `CacheManagerStore`
adapter, which also bridges the TTL unit (this library speaks **seconds**,
cache-manager speaks **milliseconds**). Build the store first, then pass the
adapter to `forRoot`:

```typescript
// cache.provider.ts
// This example uses cache-manager v5 and cache-manager-ioredis-yet.
// Newer cache-manager/Keyv versions have a different setup API.
import { caching } from 'cache-manager';
import { redisStore } from 'cache-manager-ioredis-yet';
import { CacheManagerStore } from '@charlietyn/nest-rest-sequelize';

export async function createRedisRgcStore() {
  const cache = await caching(await redisStore({ host: 'localhost', port: 6379 }));
  return new CacheManagerStore(cache); // seconds → ms handled here
}
```

```typescript
const cacheStore = await createRedisRgcStore();

@Module({
  imports: [
    GenericRestModule.forRoot({
      config: { cache: { enabled: true } },
      cacheStore, // ← Redis-backed; versioned invalidation works across processes
    }),
  ],
})
export class AppModule {}
```

Any object implementing `RgcCacheStore` (`get/set/del`, sync **or** async) is
accepted, so you can also wrap a raw `ioredis` client directly:

```typescript
import Redis from 'ioredis';
const redis = new Redis();
const cacheStore = {
  get: async (k) => { const v = await redis.get(k); return v ? JSON.parse(v) : undefined; },
  set: async (k, val, ttl) => { ttl ? await redis.set(k, JSON.stringify(val), 'EX', ttl) : await redis.set(k, JSON.stringify(val)); },
  del: async (k) => { await redis.del(k); },
};
```

---

## ⚙️ Configuration (`GenericRestModule.forRoot`)

```typescript
{
  filtering: {
    maxDepth: 5,
    maxConditions: 100,
    strictRelations: true,
    allowedOperators: [...],
  },
  cache: {
    enabled: false,
    ttl: 60,
    ttlByMethod: { list_all: 60, get_one: 30 },
    cacheableMethods: ['list_all', 'get_one'],
    varyHeaders: ['Accept-Language', 'X-Tenant-Id'],
    prefix: 'rgc:v1',
  },
}
```

---

## 📤 Exports (Excel / PDF)

Real file generation over the query. `exceljs` and `pdfkit` are **optional** —
install them only if you use the export endpoints:

```bash
npm install exceljs pdfkit
```

Inherited endpoints return a downloadable `StreamableFile`:

```
GET /products/export/excel?select=["id","name","price"]&oper={"and":["price|>=|50"]}
GET /products/export/pdf?orderby=[{"price":"desc"}]
GET /products/export/data        # raw { data, columns } JSON (no extra deps)
```

Programmatic use:

```typescript
const { buffer, filename, mimeType } = await productService.exportExcel({ select: ['id', 'name'] });
const pdf = await productService.exportPdf({ oper: { and: ['price|>=|100'] } }, { title: 'Premium products' });
```

Columns come from `?columns=` → `?select=` → the model's attributes (in that
order), and support dotted relation paths (e.g. `category.name`).

## 🔐 Role-based access & field restriction

The NestJS equivalent of the original Spatie integration (`fieldsByRole` +
`FilterRequestByRole`).

**Endpoint protection** — `@Roles()` + `RolesGuard` (reads `request.user`, set it
with your auth guard first; a `is_superuser` user bypasses all checks):

```typescript
import { Roles, RolesGuard } from '@charlietyn/nest-rest-sequelize';

@Controller('products')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ProductController extends RestController<Product> {
  constructor(service: ProductService) { super(service); }
}
```

**Field-level write restriction** — declare which roles may write which fields on
the model. Fields the current user can't write are **silently stripped** from
`POST`/`PUT` bodies (single or bulk) before persistence:

```typescript
@Table({ tableName: 'products' })
export class Product extends BaseModel {
  static readonly FIELDS_BY_ROLE = {
    admin: ['status', 'is_featured'],
    editor: ['status'],
  };
  // ...
}
```

Roles are read from `request.user` as `roles: string[]`, `roles: [{name}]`,
`role: 'x'` or `role: {name}`. Helpers `getDeniedFieldsForUser`,
`extractUserRoles` and `stripDeniedFields` are exported for custom flows.

## 🧱 Architecture

```
HTTP ──▶ RestController ──▶ BaseService ──▶ SequelizeQueryTranslator ──▶ Model ──▶ DB
                │                │
                │                ├── RgcCacheService   (versioned cache)
                │                ├── HierarchyEngine   (tree building)
                │                └── transactions      (sequelize.transaction)
                └── DatabaseErrorParser (friendly errors)
```

`oper` is translated to a Sequelize `where` using `Op` symbols; relation sub-filters become
`include` entries with `required: true`; the `relations` param becomes `include` entries with
attribute selection; `orderby` dot-notation resolves to `[{ model, as }, col, dir]` order refs.

---

## 🧪 Testing

```bash
npm ci
npm run validate  # lint, types, tests, build, package/consumer checks and audit
```

`npm test` runs SQLite integration, Nest DI/HTTP tests and release safety tests.
Release tests replace process execution; they never publish or push. The actual
tarball is installed in an independent temporary project by `npm run test:package`,
which checks CommonJS/ESM imports, TypeScript declarations, module DI, missing
optional dependencies and consumer dependency auditing. Registry access is needed.

## Public API

Import everything from the package root. `src/index.ts` is the public contract.

| Area | Exports |
|---|---|
| Base classes | `BaseModel`, `BaseService`, `RestController`, `getStatic`, `getDeclaredRelations` |
| Module/config | `GenericRestModule`, `GenericRestModuleOptions`, `RestGenericConfig`, `RestGenericConfigInput`, `FilteringConfig`, `CacheConfig`, `REST_GENERIC_CONFIG`, `RGC_CACHE_STORE`, `DEFAULT_CONFIG`, `DEFAULT_ALLOWED_OPERATORS`, `mergeConfig` |
| Queries | `SequelizeQueryTranslator`, `parseConditionString`, `decodeValue`, `toBetweenArray`, `maybeJson`, `ParsedCondition`, `parseRelationWithFields`, `normalizeRelations`, `ParsedRelation` |
| Query types | `FilterParams`, `OrderByEntry`, `LogicalOperator`, `OperNode`, `OperCondition`, `PaginationParams`, `HierarchyConfig`, `HierarchyFilterMode` |
| Result types | `DataResult`, `PaginatedResult`, `CursorPaginatedResult`, `ValidationErrors`, `WriteResult` |
| Cache | `RgcCacheService`, `RgcCacheStore`, `InMemoryCacheStore`, `CacheManagerStore`, `CacheManagerLike`, `CacheContext` |
| Relations | `RelationManager`, `OneToManyConfig`, `ManyToManyConfig`, `OneToManyConfigMap`, `ManyToManyConfigMap`, `RelationMutationConfig`, `ResolvedRelationConfig`, `RelationType`, `ModelClass`, `isManyToMany` |
| Request helpers | `injectParams`, `isBulkScenario`, `resolveRelationConfig`, `extractMutationData`, `Scenario`, `RelationName`, `SCENARIO_PARAM`, `RELATION_PARAM` |
| Hierarchy/files | `HierarchyEngine`, `ExportService`, `ExportFile`, `ExportOptions` |
| Security/errors | `Roles`, `RolesGuard`, `ROLES_KEY`, `getDeniedFieldsForUser`, `extractUserRoles`, `isSuperuser`, `stripDeniedFields`, `RoleAwareUser`, `DatabaseErrorParser`, `ParsedDbError` |

Types/interfaces are compile-time exports, not JavaScript runtime objects.
The only additional subpath is `@charlietyn/nest-rest-sequelize/package.json`.

## Errors and validation

Invalid filters and unconfigured relations produce Nest `BadRequestException`;
missing rows produce `NotFoundException`. Controller methods map database errors
through `DatabaseErrorParser` (for example, unique constraints become HTTP 409).
Services called directly can still throw raw Sequelize errors; callers can apply
`DatabaseErrorParser.handle(error)`. Driver details may be included: redact them
with an application exception filter before exposing sensitive information.

`actionValidate` returns success by default; override it for business validation.
Excel/PDF calls fail with an installation hint when the optional dependency is
absent. `FIELDS_BY_ROLE` protects top-level CRUD writes, not read visibility or
every custom relation payload; enforce application authorization separately.

## Build and release

```sh
npm run build        # clean dist + TypeScript declarations
npm pack             # builds and creates a local .tgz
npm run release -- --dry-run
npm run release                 # patch by default
npm run release -- patch
npm run release -- minor
npm run release -- major
```

All release modes require a clean `main`. Dry run validates and previews without
version changes, commits, tags, publication or push. A real invocation also checks
npm authentication, an unused version/tag and synchronization with `origin/main`,
then bumps the real package version, commits/tags, publishes the inspected tarball
with public access, and pushes only the release commit/tag. A failed push after
publication is reported explicitly and must be recovered without republishing.

CI only validates; local release is the single publishing mechanism. See
[CONTRIBUTING](https://github.com/charlietyn/nest-rest-generic-sequelize/blob/main/CONTRIBUTING.md)
for requirements, SemVer, OIDC rationale and failure recovery, and
[SECURITY](https://github.com/charlietyn/nest-rest-generic-sequelize/blob/main/SECURITY.md)
for security boundaries. Review [CHANGELOG](CHANGELOG.md) before releasing.

## License

MIT © Charlietyn
