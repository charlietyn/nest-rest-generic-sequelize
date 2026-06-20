# nest-rest-generic-sequelize

> Generic NestJS base classes (**Model / Service / Controller**) for building advanced REST CRUD APIs with **Sequelize** (`sequelize-typescript`).
> TypeScript port of the Laravel package [`rest-generic-class`](https://github.com/charlietyn/rest-generic-class) — same HTTP contract, same feature set.

Build a fully-featured CRUD endpoint (dynamic filtering, eager relations, ordering, pagination, hierarchical trees, transactions, versioned caching and human-friendly DB errors) in **three small files**.

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
| DTO validation (class-validator) | ✅ |

---

## 📦 Installation

```bash
npm install nest-rest-generic-sequelize
# peer deps (already in a typical Nest + Sequelize project)
npm install @nestjs/common @nestjs/core @nestjs/sequelize sequelize sequelize-typescript reflect-metadata
```

---

## 🚀 Quick start (3-file pattern)

### 1. Model — extend `BaseModel`, declare the whitelist

```typescript
import { Table, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { BaseModel } from 'nest-rest-generic-sequelize';
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
import { BaseService, REST_GENERIC_CONFIG, RestGenericConfig, DEFAULT_CONFIG, RgcCacheService } from 'nest-rest-generic-sequelize';
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
import { RestController } from 'nest-rest-generic-sequelize';
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
import { GenericRestModule } from 'nest-rest-generic-sequelize';

@Module({
  imports: [
    SequelizeModule.forRoot({ /* ...dialect, models... */ }),
    GenericRestModule.forRoot({ config: { cache: { enabled: true } } }),
    SequelizeModule.forFeature([Product]),
  ],
  providers: [ProductService],
  controllers: [ProductController],
})
export class AppModule {}
```

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
import { caching } from 'cache-manager';
import { redisStore } from 'cache-manager-ioredis-yet';
import { CacheManagerStore } from 'nest-rest-generic-sequelize';

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
import { Roles, RolesGuard } from 'nest-rest-generic-sequelize';

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
npm test     # in-memory SQLite integration tests
```

## License

MIT © Charlietyn
