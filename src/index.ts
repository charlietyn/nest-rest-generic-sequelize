/**
 * nest-rest-generic-sequelize — public API barrel.
 * TypeScript/Sequelize port of the Laravel package `rest-generic-class`.
 *
 * @author Charlietyn
 */

// Base classes
export { BaseModel, getStatic, getDeclaredRelations } from './base/base.model';
export { BaseService } from './base/base.service';
export { RestController } from './base/rest.controller';

// Module + config
export { GenericRestModule, GenericRestModuleOptions, RGC_CACHE_STORE } from './module/generic-rest.module';
export {
  RestGenericConfig,
  FilteringConfig,
  CacheConfig,
  REST_GENERIC_CONFIG,
  DEFAULT_CONFIG,
  DEFAULT_ALLOWED_OPERATORS,
  mergeConfig,
} from './config/rest-generic.config';

// Interfaces
export * from './interfaces/filter-params.interface';
export * from './interfaces/service-result.interface';

// Query engine
export { SequelizeQueryTranslator } from './query/sequelize.translator';
export {
  parseConditionString,
  decodeValue,
  toBetweenArray,
  maybeJson,
  ParsedCondition,
} from './query/condition.parser';
export { parseRelationWithFields, normalizeRelations, ParsedRelation } from './query/relations.parser';

// Cache
export {
  RgcCacheService,
  RgcCacheStore,
  InMemoryCacheStore,
  CacheManagerStore,
  CacheManagerLike,
  CacheContext,
} from './cache/cache.service';

// Hierarchy
export { HierarchyEngine } from './hierarchy/hierarchy.engine';

// Export (Excel / PDF)
export { ExportService, ExportFile, ExportOptions } from './export/export.service';

// Security (role-based access + field restriction)
export { Roles, RolesGuard, ROLES_KEY } from './security/roles.guard';
export {
  getDeniedFieldsForUser,
  extractUserRoles,
  isSuperuser,
  stripDeniedFields,
  RoleAwareUser,
} from './security/field-access';

// Errors
export { DatabaseErrorParser, ParsedDbError } from './errors/database-error-parser';
