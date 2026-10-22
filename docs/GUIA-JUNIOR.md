# Guía para juniors — `@charlietyn/nest-rest-sequelize`

> Esta guía enseña a **usar** la librería. El `README.md` es la referencia rápida
> (tabla de features + sintaxis); `CLAUDE.md` son las reglas para **modificar**
> la librería. Si sólo vas a construir endpoints, te basta con este documento.

---

## 1. El problema que resuelve

Un CRUD REST "de verdad" no es sólo `findAll()`. Tus clientes acaban pidiendo:

filtrar por varios campos con AND/OR, ordenar por una columna de una relación,
traer relaciones anidadas, paginar (y también scroll infinito), árboles de
categorías, exportar a Excel, que la escritura sea transaccional, que un error
de clave foránea no devuelva un stacktrace de Postgres, y que todo eso vaya
cacheado.

Escribir eso a mano en cada entidad son ~400 líneas repetidas por modelo. Esta
librería lo pone en tres clases base que heredas:

```
Sin la librería          Con la librería
─────────────────        ─────────────────
~400 líneas/entidad  →   ~30 líneas/entidad (modelo + servicio + controlador)
```

Es un **port** del paquete Laravel `rest-generic-class`. Por eso verás métodos en
`snake_case` (`list_all`, `get_one`, `update_multiple`): se mantienen a propósito
para que el contrato HTTP sea idéntico. Cada uno tiene también su alias camelCase
(`listAll`, `getOne`, `updateMultiple`) — usa el que prefieras.

---

## 2. Modelo mental: el viaje de una petición

Interioriza este diagrama y el 80 % de la librería te resultará obvio:

```
  GET /products?oper={...}&relations=["category"]
        │
        ▼
  ┌──────────────────┐  process_request(): fusiona req.query + req.body
  │  RestController  │  en un único objeto FilterParams.
  └────────┬─────────┘  Aquí también se recortan campos por rol (escritura).
           │
           ▼
  ┌──────────────────┐  ¿Está cacheado? → devuelve.
  │   BaseService    │  Escrituras → dentro de sequelize.transaction.
  └────────┬─────────┘  Al terminar una escritura → bumpCache().
           │
           ▼
  ┌──────────────────────────┐  Traduce FilterParams → FindOptions de Sequelize
  │ SequelizeQueryTranslator │  (where con símbolos Op, include, order, limit).
  └────────┬─────────────────┘
           │
           ▼
        Modelo → Base de datos
```

Y si algo revienta, `DatabaseErrorParser` convierte el error de la BD en una
excepción de NestJS legible (409 en vez de "duplicate key value violates unique
constraint").

**La idea clave:** tú nunca escribes la query. Escribes el *modelo* y declaras
qué está permitido; el cliente compone la consulta desde la URL.

---

## 3. Tu primer CRUD, paso a paso

### Paso 1 — El modelo

```typescript
import { Table, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { BaseModel } from '@charlietyn/nest-rest-sequelize';
import { Category } from './category.model';

@Table({ tableName: 'products' })
export class Product extends BaseModel {
  static readonly MODEL = 'product';                  // ← clave de caché y de bulk
  static readonly RELATIONS = ['category'] as const;  // ← lista blanca de seguridad

  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true }) id!: number;
  @Column(DataType.STRING) name!: string;
  @Column(DataType.DECIMAL(10, 2)) price!: number;

  @ForeignKey(() => Category) @Column(DataType.INTEGER) category_id!: number;
  @BelongsTo(() => Category, 'category_id') category!: Category;
}
```

> **Error nº 1 de junior:** olvidar `RELATIONS`. Si no está, `?relations=["category"]`
> devuelve `400 Relation 'category' is not allowed`. **No es un bug, es la
> defensa**: sin lista blanca, cualquiera podría pedir `?relations=["user"]` y
> sacar datos de otra tabla.

### Paso 2 — El servicio

```typescript
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

Sí: el cuerpo está vacío. Todo se hereda. Sólo escribes aquí cuando necesitas
lógica de negocio propia.

### Paso 3 — El controlador

```typescript
@Controller('products')
export class ProductController extends RestController<Product> {
  constructor(service: ProductService) { super(service); }
}
```

Los decoradores de ruta (`@Get()`, `@Post()`, …) están declarados en
`RestController` y **se heredan** al poner `@Controller` en la subclase.

### Paso 4 — Registrarlo

```typescript
@Module({
  imports: [
    SequelizeModule.forRoot({ /* dialect, models... */ }),
    GenericRestModule.forRoot({ config: { cache: { enabled: true } } }),
    SequelizeModule.forFeature([Product]),
  ],
  providers: [ProductService],
  controllers: [ProductController],
})
export class AppModule {}
```

### Lo que acabas de conseguir

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/products` | listar (filtros, orden, paginación, relaciones, árbol) |
| GET | `/products/get/one` | primer registro que cumpla el filtro |
| GET | `/products/:id` | un registro |
| POST | `/products` | crear (uno, o varios con `{product:[...]}`) |
| PUT | `/products/:id` | actualizar |
| PUT | `/products/update/multiple` | actualizar en lote |
| DELETE | `/products/:id` | borrar |
| DELETE | `/products/delete/by-id` | borrar varios (`{ids:[1,2,3]}`) |
| POST | `/products/validate` | validar sin persistir |
| GET | `/products/export/data` | `{ data, columns }` en JSON |
| GET | `/products/export/excel` | descarga `.xlsx` |
| GET | `/products/export/pdf` | descarga `.pdf` |

---

## 4. Las constantes del modelo

Toda la magia se configura con `static` en el modelo. La librería las lee con
`getStatic()`, así que **nunca sobrescribes métodos** para cambiar comportamiento:

| Constante | Para qué sirve | Si no la pones |
|---|---|---|
| `MODEL` | Clave de caché y clave del payload bulk (`{product:[...]}`) | Se usa el nombre de la clase; el bulk por clave deja de detectarse |
| `RELATIONS` | Lista blanca de relaciones cargables/filtrables | Ninguna relación se puede pedir (con `strictRelations: true`, el valor por defecto) |
| `HIERARCHY_FIELD_ID` | Columna padre para árboles (p. ej. `'parent_id'`) | `?hierarchy=true` no hace nada |
| `CACHE_INVALIDATES` | Otros modelos cuya caché se invalida al escribir en éste | Sólo se invalida este modelo |
| `FIELD_KEY_UPDATE` | Columna usada por `PUT /:id` en vez de la PK (p. ej. `'uuid'`) | Se usa la clave primaria |
| `FIELDS_BY_ROLE` | Qué roles pueden **escribir** qué campos | Todos los campos son escribibles |

```typescript
export class Product extends BaseModel {
  static readonly MODEL = 'product';
  static readonly RELATIONS = ['category', 'tags'] as const;
  static readonly HIERARCHY_FIELD_ID = null;
  static readonly CACHE_INVALIDATES = [Category];       // al tocar Product, caduca Category
  static readonly FIELD_KEY_UPDATE = null;
  static readonly FIELDS_BY_ROLE = {
    admin:  ['status', 'is_featured'],
    editor: ['status'],
  };
}
```

---

## 5. El lenguaje de consulta

Es la parte que más vas a usar. Todos los parámetros valen tanto en `query
string` como en el `body` (el controlador los fusiona).

### `oper` — filtros

Una condición es un **string** con tres partes: `"campo|operador|valor"`.
Se agrupan en bloques `and` / `or`, y los bloques **anidan** sin límite práctico:

```jsonc
// precio >= 50 Y estado = activo
?oper={"and":["price|>=|50","status|=|active"]}

// nombre = iPhone O nombre = Pixel
?oper={"or":["name|=|iPhone","name|=|Pixel"]}

// activo Y (precio < 100 O destacado)
?oper={"and":["status|=|active",{"or":["price|<|100","featured|=|true"]}]}
```

**Operadores disponibles:** `=` `!=` `<` `>` `<=` `>=` `like` `not like`
`ilike` `not ilike` `in` `not in` `between` `not between` `null` `not null`
`date` `not date` `regexp` `not regexp`.

Los valores separados por coma se convierten en array automáticamente:
`status|in|active,pending`.

#### Filtros sobre relaciones (el `whereHas` de Laravel)

**Regla de oro:** dentro de `oper`, cualquier clave que **no sea** `and` ni `or`
es el nombre de una relación.

```jsonc
// productos cuya categoría se llama "Phones"
?oper={"category":{"and":["name|=|Phones"]}}&relations=["category"]

// ruta anidada
?oper={"user.roles":{"and":["name|=|admin"]}}
```

Por dentro esto genera un `include` con `required: true` (equivalente a un
`INNER JOIN`), así que **filtra** el resultado, no sólo lo carga.

### `relations` — carga y selección

```jsonc
?relations=["category"]              // cargar la asociación
?relations=["category:id,name"]      // cargar sólo esas columnas
?relations=["user.roles:id,name"]    // anidada + columnas
?relations=all                       // todas las de la lista blanca
```

### `orderby`, `select`, `pagination`

```jsonc
?orderby=[{"price":"desc"},{"name":"asc"}]
?orderby=[{"category.name":"asc"}]    // ordenar por columna de una relación

?select=["id","name","price"]

?pagination={"page":1,"pageSize":20}                        // clásica
?pagination={"infinity":true,"pageSize":20,"cursor":"123"}  // scroll infinito
```

El tamaño de página por defecto es **15**.

La paginación clásica devuelve `{ current_page, data, per_page, total,
last_page, from, to }`. La `infinity` devuelve `{ data, next_cursor, has_more }`
— pásale el `next_cursor` de la respuesta anterior y **ignora el `orderby`**
(el cursor ordena por clave primaria; es así por diseño, es lo que lo hace
estable).

### `hierarchy` — árboles

Requiere `static HIERARCHY_FIELD_ID = 'parent_id'` en el modelo.

```jsonc
?hierarchy=true
?hierarchy={"filter_mode":"with_descendants","children_key":"children","max_depth":3}
```

Los 5 modos: `match_only` (sólo lo que casa), `with_ancestors` (+ padres),
`with_descendants` (+ hijos), `full_branch` (rama completa), `root_filter`
(filtra sólo las raíces).

---

## 6. Relaciones anidadas (endpoints `/:parent_id/:relation/...`)

Si además de `/products` quieres `/products/1/tags`, declara la configuración en
el controlador. **No** hace falta que la asociación de Sequelize esté declarada:
la librería trabaja con las claves que le des.

```typescript
@Controller('products')
export class ProductController extends RestController<Product> {
  constructor(service: ProductService) { super(service); }

  // Uno-a-muchos: la tabla hija tiene una FK al padre
  protected oneToManyConfig = {
    reviews: {
      relationship: 'reviews',
      parentModel: Product,
      relatedModel: Review,
      foreignKey: 'product_id',   // columna en Review
      localKey: 'id',             // columna en Product (por defecto, la PK)
      mutation: { dataKey: ['reviews'], deleteRelated: true },
    },
  };

  // Muchos-a-muchos: hay tabla pivote
  protected manyToManyConfig = {
    tags: {
      relationship: 'tags',
      parentModel: Product,
      relatedModel: Tag,
      pivotModel: ProductTag,
      parentKey: 'product_id',    // columna del pivote → padre
      relatedKey: 'tag_id',       // columna del pivote → relacionado
      mutation: { dataKey: ['tags'], deleteRelated: false, pivotColumns: ['note'] },
    },
  };
}
```

Con eso quedan activas estas rutas (`:relation` es la clave del mapa):

```
GET    /products/1/tags                    listar
GET    /products/1/tags/5                  ver uno
POST   /products/1/tags                    crear
POST   /products/1/tags/bulk               crear varios
PUT    /products/1/tags/5                  actualizar
PUT    /products/1/tags/bulk               actualizar varios
DELETE /products/1/tags/5                  borrar
DELETE /products/1/tags/bulk               borrar varios

# sólo M2M:
POST   /products/1/tags/attach             enlazar (+ `?_scenario=sync|toggle`)
DELETE /products/1/tags/detach/5           desenlazar
DELETE /products/1/tags/detach/bulk        desenlazar varios
PUT    /products/1/tags/pivot/5            editar columnas del pivote
PUT    /products/1/tags/pivot/bulk         editar el pivote en lote
```

Tres cosas que conviene saber:

- **`deleteRelated`** decide si borrar la relación borra también la fila
  relacionada. En M2M casi siempre lo quieres a `false` (quitar la etiqueta de un
  producto no debería borrar la etiqueta del sistema).
- **`pivotColumns`** es una lista blanca: cualquier otra columna que mandes al
  pivote se descarta silenciosamente.
- **Todas las operaciones están acotadas al padre de la URL.** `/products/1/tags/bulk`
  no puede tocar filas de `/products/2`; los ids que no pertenezcan a la relación
  vuelven en `error.not_found_ids` y la operación reporta `success: false`.

---

## 7. Caché: invalidación por versión

Esta parte confunde a casi todo el mundo al principio, así que aquí está el
modelo mental completo.

**Lo que NO hace:** buscar y borrar claves (`DEL products:*`). Eso es lento y en
Redis directamente peligroso.

**Lo que hace:** cada modelo tiene un **contador de versión** en el almacén. Ese
número forma parte de la clave de caché:

```
clave = sha1({ operación, modelo, params, ..., version: 7 })
```

Cuando escribes, el contador pasa de 7 a 8. Todas las claves que contenían el 7
dejan de generarse: quedan huérfanas y expiran solas por TTL. **Invalidar cuesta
una sola escritura**, sin importar cuántas entradas hubiera.

```
   GET  → clave(...v7) → MISS → consulta BD → guarda
   GET  → clave(...v7) → HIT   ← servido de caché
   POST → bumpVersion  → v8
   GET  → clave(...v8) → MISS → consulta BD   ← la entrada v7 ya no se busca
```

Por defecto la caché está **desactivada** (`cache.enabled: false`), y sólo
`list_all` y `get_one` son cacheables (TTL 60 s y 30 s).

Por petición puedes ajustar:

```
?cache=false        desactiva la caché para esta petición
?cache_ttl=300      TTL propio para esta petición
```

Para Redis (o cualquier backend fuera del proceso), envuelve un store de
`cache-manager` con `CacheManagerStore` — el adaptador traduce las unidades
(esta librería habla en **segundos**, cache-manager en **milisegundos**):

```typescript
const cache = await caching(await redisStore({ host: 'localhost', port: 6379 }));
GenericRestModule.forRoot({
  config: { cache: { enabled: true } },
  cacheStore: new CacheManagerStore(cache),
});
```

---

## 8. Seguridad: las tres barreras

| Barrera | Qué protege | Dónde se configura |
|---|---|---|
| `RELATIONS` + `strictRelations` | Que nadie cargue/filtre una relación no prevista | `static RELATIONS` en el modelo |
| `RolesGuard` + `@Roles()` | Quién puede llamar al endpoint | Decoradores en el controlador |
| `FIELDS_BY_ROLE` | Qué campos puede **escribir** cada rol | `static FIELDS_BY_ROLE` en el modelo |

```typescript
@Controller('products')
@UseGuards(AuthGuard('jwt'), RolesGuard)   // tu guard de auth va PRIMERO
export class ProductController extends RestController<Product> { /* ... */ }
```

Los roles se leen de `request.user` y se aceptan varias formas: `roles: string[]`,
`roles: [{name}]`, `role: 'x'` o `role: {name}`. Un usuario con `is_superuser`
salta todas las comprobaciones.

> **Ojo con `FIELDS_BY_ROLE`:** restringe **escritura**, no lectura. Los campos
> prohibidos se eliminan del body de `POST`/`PUT` **en silencio** (no da error).
> Si necesitas ocultar campos en la lectura, usa `select` o un serializador.

---

## 9. Exportar a Excel / PDF

`exceljs` y `pdfkit` son dependencias **opcionales**: la librería funciona sin
ellas y sólo las carga (`import` diferido) si usas los endpoints de exportación.

```bash
npm install exceljs pdfkit   # sólo si vas a exportar
```

```
GET /products/export/excel?select=["id","name","price"]&oper={"and":["price|>=|50"]}
GET /products/export/pdf?orderby=[{"price":"desc"}]
GET /products/export/data     # JSON, sin dependencias extra
```

Las columnas salen de `?columns=` → `?select=` → los atributos del modelo, en ese
orden, y admiten rutas con punto (`category.name`).

---

## 10. Errores frecuentes (y qué significan)

| Síntoma | Causa real | Solución |
|---|---|---|
| `400 Relation 'x' is not allowed` | La relación no está en `RELATIONS` | Añádela al `static RELATIONS` del modelo |
| `?relations=["cat"]` no devuelve nada anidado | La asociación de Sequelize no está declarada | Añade `@BelongsTo` / `@HasMany` en el modelo |
| El bulk `{product:[...]}` se crea como un solo registro | La clave no coincide con `MODEL` en minúsculas | `static MODEL = 'product'` → la clave del body es `product` |
| `?hierarchy=true` se ignora | Falta `HIERARCHY_FIELD_ID` | Declara la columna padre en el modelo |
| Sigo viendo datos viejos después de escribir | La caché estaba activa y la escritura no pasó por el servicio | Escribe siempre a través de `BaseService`; las escrituras hacen `bumpCache()` |
| `?orderby` no se aplica con scroll infinito | `infinity` ordena por PK a propósito | Usa paginación clásica si necesitas orden propio |
| `500` con un stacktrace de Postgres | Llamaste al servicio fuera de una acción del controlador | Envuelve en `try/catch` → `DatabaseErrorParser.handle(e)` |
| Un campo que envío no se guarda | `FIELDS_BY_ROLE` lo está recortando para tu rol | Revisa el mapa de roles del modelo |

---

## 11. Si vas a tocar la librería (no sólo usarla)

```bash
npm run build        # tsc → dist/  (esto es lo que se publica)
npm test             # jest sobre SQLite en memoria (no hay mocks)
npm run test:cov     # con cobertura
npm run lint         # eslint --fix
npx jest test/base-service.spec.ts             # un solo fichero
npx jest -t "applies relation filter"          # un solo test por nombre
```

Cinco reglas del repositorio:

1. **Todo lo público se re-exporta desde `src/index.ts`.** La API publicada es
   literalmente lo que exporta ese fichero.
2. **Mantén la paridad con Laravel.** Método nuevo en el servicio → nombre en
   `snake_case` **más** alias camelCase.
3. **El comportamiento nuevo se activa con una `static` en `BaseModel`**, leída
   con `getStatic()` — no obligues a sobrescribir métodos.
4. **Las dependencias opcionales siguen siendo opcionales.** Import diferido +
   `peerDependenciesMeta.optional`.
5. **`dist/` no se toca a mano.** Es salida de build.

Los tests usan una base SQLite **real** en memoria, no mocks: arrancan modelos de
Sequelize de verdad y comprueban los resultados de las consultas. Si añades una
función, añade su test en `test/`.

---

## 12. Glosario

| Término | Significado aquí |
|---|---|
| **`FilterParams`** | El objeto único con todos los parámetros de consulta, tras fusionar query + body |
| **`oper`** | El árbol de filtros AND/OR de la URL |
| **Filtro de relación** | Clave dentro de `oper` que no es `and`/`or`; se traduce a `include` con `required: true` |
| **Lista blanca (`RELATIONS`)** | Frontera de seguridad: relaciones que un cliente puede pedir |
| **`Op`** | Los símbolos de operador de Sequelize (`Op.and`, `Op.eq`, …); `oper` se traduce directamente a ellos |
| **Bump de versión** | Incrementar el contador de caché de un modelo para invalidar sus entradas |
| **Pivote** | La tabla intermedia de una relación muchos-a-muchos |
| **Escenario (`_scenario`)** | Parámetro que cambia el modo de una operación (`bulk`, `sync`, `toggle`) |
| **O2M / M2M** | Uno-a-muchos / muchos-a-muchos |
