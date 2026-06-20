import { NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import type { FindOptions, Model, ModelStatic, WhereOptions, Transaction } from 'sequelize';
import { DEFAULT_CONFIG, RestGenericConfig } from '../config/rest-generic.config';
import {
  CursorPaginatedResult,
  PaginatedResult,
  WriteResult,
} from '../interfaces/service-result.interface';
import { FilterParams, PaginationParams } from '../interfaces/filter-params.interface';
import { SequelizeQueryTranslator } from '../query/sequelize.translator';
import { maybeJson } from '../query/condition.parser';
import { normalizeRelations } from '../query/relations.parser';
import { getStatic } from '../base/base.model';
import { CacheContext, RgcCacheService } from '../cache/cache.service';
import { HierarchyEngine } from '../hierarchy/hierarchy.engine';
import { ExportFile, ExportOptions, ExportService } from '../export/export.service';
import {
  getDeniedFieldsForUser,
  RoleAwareUser,
  stripDeniedFields,
} from '../security/field-access';

/**
 * Generic base service. Concrete services inject their model and pass it to
 * `super(model, ...)`. The public method surface mirrors the original Laravel
 * `BaseService` (snake_case names retained, camelCase aliases added).
 *
 * Read methods are cache-aware; write methods run inside a Sequelize
 * transaction and bump the model cache version on success.
 *
 * @author Charlietyn (TypeScript/Sequelize port)
 */
export abstract class BaseService<M extends Model = Model> {
  protected readonly translator: SequelizeQueryTranslator;
  protected readonly primaryKey: string;
  protected readonly modelName: string;

  protected cacheable: boolean | null = null;
  protected cacheTtl: number | null = null;
  protected cacheableOperations: string[] = [];

  constructor(
    protected readonly model: ModelStatic<M>,
    protected readonly config: RestGenericConfig = DEFAULT_CONFIG,
    protected readonly cache?: RgcCacheService,
  ) {
    this.translator = new SequelizeQueryTranslator(model as unknown as ModelStatic<Model>, config);
    this.primaryKey = model.primaryKeyAttribute ?? 'id';
    this.modelName = getStatic<string>(model, 'MODEL', '') || model.name;
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  async list_all(params: FilterParams = {}, toJson = true, ctx?: CacheContext): Promise<unknown> {
    if (this.cache && this.shouldCache('list_all', params)) {
      return this.cache.remember(
        'list_all',
        this.modelName,
        params as Record<string, unknown>,
        ctx,
        this.cacheTtl,
        await this.relationVersions(params),
        () => this.listAllRaw(params, toJson),
      );
    }
    return this.listAllRaw(params, toJson);
  }

  listAll(params?: FilterParams, toJson?: boolean, ctx?: CacheContext): Promise<unknown> {
    return this.list_all(params, toJson, ctx);
  }

  private async listAllRaw(params: FilterParams, toJson: boolean): Promise<unknown> {
    if (params.hierarchy && this.hierarchyFieldId()) {
      return this.listHierarchy(params, toJson);
    }
    const options = this.translator.buildFindOptions(params);
    const pagination = maybeJson<PaginationParams>(params.pagination);
    if (pagination) {
      return this.paginate(options, pagination);
    }
    const rows = await this.model.findAll(options);
    return toJson ? { data: rows } : rows.map((r) => r.toJSON());
  }

  async get_one(params: FilterParams = {}, toJson = true, ctx?: CacheContext): Promise<unknown> {
    if (this.cache && this.shouldCache('get_one', params)) {
      return this.cache.remember(
        'get_one',
        this.modelName,
        params as Record<string, unknown>,
        ctx,
        this.cacheTtl,
        await this.relationVersions(params),
        () => this.getOneRaw(params, toJson),
      );
    }
    return this.getOneRaw(params, toJson);
  }

  getOne(params?: FilterParams, toJson?: boolean, ctx?: CacheContext): Promise<unknown> {
    return this.get_one(params, toJson, ctx);
  }

  private async getOneRaw(params: FilterParams, toJson: boolean): Promise<unknown> {
    const options = this.translator.buildFindOptions(params);
    const row = await this.model.findOne(options);
    return toJson ? { data: row ?? null } : (row?.toJSON() ?? {});
  }

  async show(params: FilterParams, id: unknown): Promise<unknown> {
    if (params.hierarchy && this.hierarchyFieldId()) {
      return this.showHierarchy(params, id);
    }
    const options = this.translator.buildFindOptions({ ...params, pagination: null, orderby: null });
    options.where = this.andWhere(options.where, { [this.primaryKey]: id } as WhereOptions);
    const row = await this.model.findOne(options);
    if (!row) throw new NotFoundException(`${this.modelName} with id ${String(id)} not found.`);
    return row;
  }

  // ==========================================================================
  // WRITE (transactional)
  // ==========================================================================

  async create(params: Record<string, unknown>): Promise<WriteResult> {
    const modelKey = String(getStatic<string>(this.model, 'MODEL', '')).toLowerCase();
    const isBulk = (modelKey && params[modelKey] !== undefined) || Array.isArray(params);
    const result = await this.transaction(async (t) => {
      if (isBulk) {
        const list = (Array.isArray(params) ? params : (params[modelKey] as unknown[])) ?? [];
        const out: WriteResult = { success: true, models: [] };
        for (const item of list as Record<string, unknown>[]) {
          const created = await this.model.create(item as never, { transaction: t });
          out.models!.push({ success: true, model: created });
        }
        return out;
      }
      const created = await this.model.create(params as never, { transaction: t });
      return { success: true, model: created } as WriteResult;
    });
    if (result.success) await this.bumpCache();
    return result;
  }

  async update(attributes: Record<string, unknown>, id: unknown): Promise<WriteResult> {
    const fieldKey = getStatic<string | null>(this.model, 'FIELD_KEY_UPDATE', null) ?? this.primaryKey;
    const result = await this.transaction(async (t) => {
      const instance = await this.model.findOne({ where: { [fieldKey]: id } as WhereOptions, transaction: t });
      if (!instance) throw new NotFoundException(`${this.modelName} with ${fieldKey} ${String(id)} not found.`);
      await instance.update(attributes as never, { transaction: t });
      return { success: true, model: instance } as WriteResult;
    });
    if (result.success) await this.bumpCache();
    return result;
  }

  async update_multiple(list: Record<string, unknown>[]): Promise<WriteResult> {
    const result = await this.transaction(async (t) => {
      const out: WriteResult = { success: true, models: [] };
      for (const item of list) {
        const id = item[this.primaryKey];
        const instance = await this.model.findOne({ where: { [this.primaryKey]: id } as WhereOptions, transaction: t });
        if (!instance) {
          out.success = false;
          out.models!.push({ success: false, message: `Record ${String(id)} not found.` });
          continue;
        }
        await instance.update(item as never, { transaction: t });
        out.models!.push({ success: true, model: instance });
      }
      return out;
    });
    if (result.success) await this.bumpCache();
    return result;
  }

  updateMultiple(list: Record<string, unknown>[]): Promise<WriteResult> {
    return this.update_multiple(list);
  }

  async destroy(id: unknown): Promise<WriteResult> {
    const result = await this.transaction(async (t) => {
      const instance = await this.model.findOne({ where: { [this.primaryKey]: id } as WhereOptions, transaction: t });
      if (!instance) throw new NotFoundException(`${this.modelName} with id ${String(id)} not found.`);
      await instance.destroy({ transaction: t });
      return { success: true, model: instance } as WriteResult;
    });
    if (result.success) await this.bumpCache();
    return result;
  }

  async destroybyid(ids: unknown): Promise<WriteResult> {
    const list = Array.isArray(ids) ? ids : maybeJson<unknown[]>(ids);
    const idArray = Array.isArray(list) ? list : [list];
    const affected = await this.model.destroy({ where: { [this.primaryKey]: { [Op.in]: idArray } } as WhereOptions });
    const success = affected > 0;
    if (success) await this.bumpCache();
    return { success };
  }

  destroyById(ids: unknown): Promise<WriteResult> {
    return this.destroybyid(ids);
  }

  // ==========================================================================
  // EXPORT
  // ==========================================================================

  async exportData(params: FilterParams): Promise<{ data: Record<string, unknown>[]; columns: string[] }> {
    const result = (await this.list_all(params)) as { data?: unknown[] };
    const raw = Array.isArray(result.data) ? result.data : [];
    const data = raw.map((r) =>
      r && typeof (r as Model).toJSON === 'function' ? (r as Model).toJSON() : r,
    ) as Record<string, unknown>[];
    return { data, columns: this.resolveExportColumns(params) };
  }

  /** Generate an .xlsx file from the current query (requires `exceljs`). */
  async exportExcel(params: FilterParams, options: ExportOptions = {}): Promise<ExportFile> {
    const { data, columns } = await this.exportData(params);
    return ExportService.toExcel(data, columns, {
      filename: params.filename ?? 'export.xlsx',
      ...options,
    });
  }

  /** Generate a PDF file from the current query (requires `pdfkit`). */
  async exportPdf(params: FilterParams, options: ExportOptions = {}): Promise<ExportFile> {
    const { data, columns } = await this.exportData(params);
    return ExportService.toPdf(data, columns, {
      filename: params.filename ?? 'export.pdf',
      title: options.title ?? this.modelName,
      ...options,
    });
  }

  // ==========================================================================
  // Role-based field restriction (FIELDS_BY_ROLE)
  // ==========================================================================

  /** The model class backing this service. */
  getModelClass(): Function {
    return this.model;
  }

  /** Fields the given user may not write, per the model's FIELDS_BY_ROLE map. */
  getDeniedFields(user: RoleAwareUser | null | undefined): string[] {
    return getDeniedFieldsForUser(this.model, user);
  }

  /** Strip restricted fields from a write payload for the given user. */
  stripForUser<P extends Record<string, unknown>>(payload: P | P[], user: RoleAwareUser | null | undefined): P | P[] {
    return stripDeniedFields(payload, this.getDeniedFields(user));
  }

  protected resolveExportColumns(params: FilterParams): string[] {
    if (params.columns) {
      return Array.isArray(params.columns) ? params.columns : String(params.columns).split(',').map((c) => c.trim());
    }
    const select = params.select ?? '*';
    if (select === '*' || (Array.isArray(select) && select[0] === '*')) {
      return Object.keys(this.model.getAttributes());
    }
    return Array.isArray(select) ? select : String(select).split(',').map((c) => c.trim());
  }

  // ==========================================================================
  // HIERARCHY
  // ==========================================================================

  async listHierarchy(params: FilterParams, toJson = true): Promise<unknown> {
    const fieldId = this.hierarchyFieldId();
    if (!fieldId) {
      throw new NotFoundException(
        `Model ${this.modelName} does not support hierarchical listing. Define static HIERARCHY_FIELD_ID.`,
      );
    }
    const config = HierarchyEngine.normalizeParams(params.hierarchy);
    if (!config) {
      const { hierarchy, ...rest } = params;
      return this.list_all(rest, toJson);
    }
    const options = this.translator.buildFindOptions({ ...params, pagination: null });
    const matched = (await this.model.findAll(options)).map((r) => r.toJSON() as Record<string, unknown>);
    const engine = new HierarchyEngine(this.model as unknown as ModelStatic<Model>, fieldId, this.primaryKey);
    const tree = await engine.build(matched, config);
    if (params.pagination) {
      return engine.paginateRoots(tree, maybeJson(params.pagination), config.children_key, this.defaultPageSize());
    }
    return toJson ? { data: tree } : tree;
  }

  async showHierarchy(params: FilterParams, id: unknown): Promise<Record<string, unknown>[]> {
    const fieldId = this.hierarchyFieldId();
    if (!fieldId) throw new NotFoundException(`Model ${this.modelName} does not support hierarchy.`);
    const config =
      HierarchyEngine.normalizeParams(params.hierarchy) ?? {
        enabled: true,
        children_key: 'children',
        max_depth: null,
        filter_mode: 'with_descendants' as const,
        include_empty_children: true,
      };
    const root = await this.model.findByPk(id as never);
    if (!root) throw new NotFoundException(`${this.modelName} with id ${String(id)} not found.`);
    const engine = new HierarchyEngine(this.model as unknown as ModelStatic<Model>, fieldId, this.primaryKey);
    return engine.build([root.toJSON() as Record<string, unknown>], config);
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  protected async paginate(
    options: FindOptions,
    pg: PaginationParams,
  ): Promise<PaginatedResult | CursorPaginatedResult> {
    const pageSize = pg.pageSize ?? pg.pagesize ?? this.defaultPageSize();

    if (pg.infinity === true) {
      const cursor = pg.cursor ?? null;
      const where = cursor
        ? this.andWhere(options.where, { [this.primaryKey]: { [Op.gt]: cursor } } as WhereOptions)
        : options.where;
      const rows = await this.model.findAll({
        ...options,
        where,
        order: [[this.primaryKey, 'ASC']],
        limit: pageSize + 1,
      });
      const hasMore = rows.length > pageSize;
      const data = hasMore ? rows.slice(0, pageSize) : rows;
      const last = data[data.length - 1];
      return {
        data,
        next_cursor: hasMore && last ? String((last.get(this.primaryKey) as unknown)) : null,
        has_more: hasMore,
      };
    }

    const page = pg.page ?? 1;
    const { rows, count } = await this.model.findAndCountAll({
      ...options,
      distinct: true,
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
    const total = typeof count === 'number' ? count : (count as { length: number }).length;
    const lastPage = Math.ceil(total / pageSize) || 1;
    return {
      current_page: page,
      data: rows,
      per_page: pageSize,
      total,
      last_page: lastPage,
      from: total > 0 ? (page - 1) * pageSize + 1 : null,
      to: total > 0 ? Math.min(page * pageSize, total) : null,
    };
  }

  protected andWhere(existing: WhereOptions | undefined, extra: WhereOptions): WhereOptions {
    if (!existing) return extra;
    return { [Op.and]: [existing, extra] } as WhereOptions;
  }

  protected transaction<R>(work: (t: Transaction) => Promise<R>): Promise<R> {
    const sequelize = this.model.sequelize;
    if (!sequelize) throw new Error('Model is not attached to a Sequelize instance.');
    return sequelize.transaction(work);
  }

  protected shouldCache(operation: string, params: FilterParams): boolean {
    if (!this.cache) return false;
    return this.cache.shouldUseCache(operation, this.cacheable, this.cacheableOperations, params);
  }

  protected async bumpCache(): Promise<void> {
    if (!this.cache) return;
    const invalidates = getStatic<readonly Function[]>(this.model, 'CACHE_INVALIDATES', []).map(
      (c) => getStatic<string>(c, 'MODEL', '') || c.name,
    );
    await this.cache.bumpVersion(this.modelName, invalidates);
  }

  protected async relationVersions(params: FilterParams): Promise<Record<string, number>> {
    if (!this.cache || !params.relations) return {};
    const allowed = getStatic<readonly string[]>(this.model, 'RELATIONS', []);
    const parsed = normalizeRelations(params.relations, [...allowed]);
    const names: string[] = [];
    const associations = this.model.associations as Record<string, { target: ModelStatic<Model> }>;
    for (const rel of parsed) {
      const assoc = associations[rel.base];
      if (assoc) names.push(getStatic<string>(assoc.target, 'MODEL', '') || assoc.target.name);
    }
    return this.cache.getRelationVersions(names);
  }

  protected hierarchyFieldId(): string | null {
    return getStatic<string | null>(this.model, 'HIERARCHY_FIELD_ID', null);
  }

  protected defaultPageSize(): number {
    return 15;
  }
}
