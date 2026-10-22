# Auditoría de preparación del paquete

Fecha: 2026-10-21. Paquete: `@charlietyn/nest-rest-sequelize`.
Versión de partida conservada: `1.0.0`. No se ha publicado ni incrementado.

## Repositorio y arquitectura

Es una biblioteca TypeScript, no una aplicación ni un monorepositorio. No contiene
bootstrap de servidor. El consumidor aporta Nest, los modelos Sequelize, conexión,
driver, autenticación y configuración mediante `GenericRestModule.forRoot`.
Se mantienen las carpetas y los contratos CRUD/query existentes:

```text
src/
  index.ts                 API pública
  base/                    BaseModel, BaseService, RestController
  config/, module/         Configuración y proveedores Nest
  query/, relations/       Filtros y operaciones O2M/M2M
  cache/, hierarchy/       Caché y árboles
  security/, errors/       Roles, campos y errores de base de datos
  export/                  Excel/PDF opcionales
  interfaces/              Tipos de entrada/salida
  example/                 Referencia; excluida del paquete
test/                      Integración y seguridad del release
scripts/                   Build auxiliar, inspección, consumidor y release
.github/workflows/ci.yml    Validación; sin publicación
dist/                      JavaScript CommonJS y declaraciones generadas
```

Se encontraron cambios locales previos en servicios, controladores, relaciones y
tests. Se conservaron. No se ha hecho commit ni push en el repositorio original.
La metadata del remoto, autor y licencia procede de Git, package.json y README.
`LICENSE` materializa los términos MIT ya declarados, sin cambiar la licencia.

## Decisiones

- Un único build CommonJS con `tsc` y declaraciones. Nest 12 usa ESM; Node moderno
  permite consumirlo mediante `require(esm)`. No se añade un segundo build.
- Nest 11/12 en peers, Node 22.12+ o 24+ como runtime. Jest con Nest 12 requiere
  Node 24.9+ y `--experimental-vm-modules`; CI separa la prueba del runtime mínimo.
- TypeScript 5.9, NodeNext y strict. `useDefineForClassFields: false` preserva los
  accesores de Sequelize. El consumidor de pruebas valida `.d.ts` sin skipLibCheck.
- `RestGenericConfigInput` acepta las secciones parciales documentadas.
- `Scenario` tiene una firma explícita compartida por Nest 11 y 12. La prueba
  de consumidor detectó que la firma inferida incluía un tipo exclusivo de Nest 12.
- `injectParams` funciona con la propiedad query sin setter de Express 5.
- class-validator/class-transformer solo se usan en ejemplos, por lo que pasan a
  desarrollo. La aplicación consumidora debe instalar/configurar sus DTOs/pipes.
- Caché acepta una interfaz estructural: no importa cache-manager ni
  @nestjs/cache-manager. Se eliminan sus metadatos de peer huérfanos. ExcelJS y
  PDFKit sí quedan como peers opcionales reales, cargados de forma diferida.
- Un solo mecanismo publica: `npm run release`, local. CI valida sin token npm ni
  permisos de escritura. OIDC queda evaluado y documentado en CONTRIBUTING.

## Dependencias y licencias

La revisión de los manifiestos instalados encontró MIT en Nest, Sequelize,
sequelize-typescript, ExcelJS, PDFKit, Jest, ESLint y los validadores; Apache-2.0
en reflect-metadata, RxJS y TypeScript; BSD-3-Clause en sqlite3; ISC en semver.
Las dependencias no se incorporan al tarball: conservan sus propios paquetes y
avisos de licencia. No se ha relicenciado código externo.

La primera auditoría registró 38 avisos, incluidos 8 altos y 1 crítico. Tras
actualizaciones compatibles y la actualización evaluada del driver **de tests**
sqlite3 5→6.0.1, quedaron **25 moderados, 0 altos y 0 críticos**. El driver mantiene
la API usada por Sequelize; las pruebas reales de SQLite verifican su integración.
Su upstream está archivado: debe revisarse antes de futuras actualizaciones.

Los avisos restantes tienen dos raíces:

- `uuid` transitivo de Sequelize/ExcelJS: límites de buffer en las funciones
  v3/v5/v6. npm no ofrece una corrección dentro de las versiones admitidas por
  esos paquetes. No se fuerza una major transitiva sin revisar los consumidores.
  [Aviso upstream](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
- `sprintf-js` en la cadena de herramientas Jest/Istanbul: precisión no limitada
  en cadenas de formato. El aviso no ofrece versión corregida. No se aceptan
  cadenas de formato externas en el proceso de tests.
  [Aviso upstream](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).

El consumidor mínimo con peers registra **5 avisos moderados** derivados de uuid,
sin altos/críticos. Un audit `--omit=dev` solo en la raíz ocultaría estos peers
porque también son devDependencies: por eso se audita el consumidor independiente.
Los conteos son una instantánea; CI consulta de nuevo y bloquea altos/críticos.

## Release y seguridad del artefacto

El allowlist limita la distribución a JS, declaraciones, README, CHANGELOG,
LICENSE y metadata. La inspección exige las rutas públicas, rechaza archivos
imprevistos y busca firmas habituales de credenciales sin imprimir sus valores.
No es una garantía de detección de todos los secretos posibles.

Release comprueba Git limpio, main, versiones coherentes, tests/build/paquete,
versión npm libre, autenticación y sincronización remota antes de incrementar.
Los tests simulan patch/minor/major, errores y el caso publicado-con-push-fallido.
No usan un publicador real. El dry-run también reconoce `npm_config_dry_run`
cuando npm/PowerShell consume la opción en vez de pasarla al script; elimina
esa opción de los procesos de validación para que sí instalen el consumidor.

## Límites que se conservan y deben conocer los consumidores

- Las pruebas de SQL usan SQLite. No se afirma validación contra servidores
  PostgreSQL/MySQL; los operadores avanzados dependen del dialecto.
- La validación DTO no se activa automáticamente en handlers genéricos y el hook
  actionValidate devuelve éxito por defecto. FIELDS_BY_ROLE no filtra lecturas.
- Los detalles de errores de driver pueden exponerse en la respuesta existente;
  aplicaciones sensibles deben redactarlos mediante un filtro de excepciones.
- Las mutaciones M2M compuestas asumen pivot y relacionado en la misma conexión.
- `_nested`, `template` y la diferencia entre los dos valores booleanos de
  soft_delete no están completamente implementados. No se ha inventado soporte.
- La caché conserva invalidación por versión y su contrato existente; no se ha
  convertido en una transacción distribuida ni en un contador atómico de Redis.

## Evidencia y pendientes

### Verificado localmente (Windows)

- `npm run validate` completo: lint (ESLint 10), tipos, **38 tests funcionales en
  8 suites**, **25 tests de release**, build limpio, inspección, instalación del
  tarball y auditorías. Finaliza con código 0 en Node 24.21.0 / Nest 12.2.0.
- Las 38 pruebas funcionales también pasan con Nest 11 en Node 24.21.0, y con
  Nest 11 y 12 en Node 26.12.0. Incluyen SQLite real, DI, HTTP y relaciones.
- Consumidores independientes con Nest 11 y 12 en **Node 22.12.0, 24.21.0 y
  26.12.0**: instalación desde `.tgz`, CommonJS, ESM nativo, declaraciones
  TypeScript con `skipLibCheck: false`, configuración e integraciones opcionales
  ausentes. Node 22.12 emite el aviso experimental de `require(esm)`.
- Paquete de **44 archivos**: JS/declaraciones y documentación autorizada;
  sin ejemplos, tests, scripts, `.env`, claves ni firmas de credenciales detectadas.
- `patch`, `minor` y `major`, prevención de duplicados, errores de validación,
  autenticación, empaquetado, publicación incierta y push fallido están probados
  con ejecución de procesos simulada. Ninguna prueba publica realmente.
- Dry-run completo en una copia temporal con Git limpio: propone `1.0.1` y
  conserva `1.0.0`, sin nuevos commits, tags ni cambios de Git. En el repositorio
  original se comprueba el rechazo por cambios pendientes, sin modificar versiones.
- YAML de CI analizado correctamente y `git diff --check` sin errores.

### Implementado pero no verificado remotamente

- Workflow de GitHub Actions con matriz Linux/Windows, Node 24/26 y Nest 11/12,
  más consumidores en el runtime mínimo 22.12. No se ha ejecutado en GitHub.
- Publicación real y sincronización remota: solo se prueba su secuencia mediante
  simulaciones; no se ha publicado ni hecho push.

### Pendiente antes de publicar

- Revisar y confirmar los cambios deseados, tener `main` limpio y sincronizado.
- Comprobar con una cuenta autorizada el acceso al scope `@charlietyn/`, la
  autenticación npm/2FA y los permisos de Git. El release real los comprueba
  hasta donde permiten los comandos de preflight; el registro puede rechazar
  posteriormente una publicación por sus políticas o permisos del paquete.
- Elegir el incremento SemVer y mover las notas de Unreleased a esa versión.
- Las pruebas contra PostgreSQL/MySQL y la corrección upstream de los avisos
  moderados siguen pendientes; no se declaran como verificadas.

El análisis graphify se conserva en `graphify-out/` como fotografía anterior a la
transformación: 507 nodos, 1.319 aristas, 20 comunidades. Advierte 12 autoaristas
y 72 aristas colapsadas por el grafo no dirigido; no hay endpoints ausentes.
No representa los archivos nuevos de empaquetado. El coste real de tokens de esa
extracción no está disponible y se indica expresamente en su informe.
