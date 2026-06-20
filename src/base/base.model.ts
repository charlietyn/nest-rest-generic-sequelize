import { Model } from 'sequelize-typescript';

/**
 * Base model carrying the static conventions used across the library, mirroring
 * the PHP `BaseModel` constants:
 *
 *   const MODEL              -> static MODEL
 *   const RELATIONS          -> static RELATIONS  (whitelist of loadable associations)
 *   const HIERARCHY_FIELD_ID -> static HIERARCHY_FIELD_ID
 *   const CACHE_INVALIDATES  -> static CACHE_INVALIDATES
 *   protected $fieldKeyUpdate-> static FIELD_KEY_UPDATE
 *   protected $fieldsByRole  -> static FIELDS_BY_ROLE
 *
 * Concrete models extend this and add the usual `sequelize-typescript` decorators.
 *
 * @author Charlietyn (TypeScript/Sequelize port)
 */
export abstract class BaseModel extends Model {
  static readonly MODEL: string = '';
  static readonly RELATIONS: readonly string[] = [];
  static readonly HIERARCHY_FIELD_ID: string | null = null;
  static readonly CACHE_INVALIDATES: readonly Function[] = [];
  static readonly FIELD_KEY_UPDATE: string | null = null;
  static readonly FIELDS_BY_ROLE: Record<string, string[]> = {};
}

/** Read a static convention member off any model class, with a fallback. */
export function getStatic<T>(cls: Function, key: string, fallback: T): T {
  const value = (cls as unknown as Record<string, unknown>)[key];
  return (value === undefined || value === null ? fallback : value) as T;
}

export function getDeclaredRelations(cls: Function): string[] {
  return [...getStatic<readonly string[]>(cls, 'RELATIONS', [])];
}
