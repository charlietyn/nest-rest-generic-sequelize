import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import type { FindOptions, Model, ModelStatic, Transaction, WhereOptions } from 'sequelize';
import { RestGenericConfig } from '../config/rest-generic.config';
import { FilterParams, PaginationParams } from '../interfaces/filter-params.interface';
import { WriteResult } from '../interfaces/service-result.interface';
import { SequelizeQueryTranslator } from '../query/sequelize.translator';
import { maybeJson } from '../query/condition.parser';
import {
  ManyToManyConfig,
  OneToManyConfig,
  RelationMutationConfig,
  ResolvedRelationConfig,
  isManyToMany,
} from './relation-config';

/**
 * Executes relation CRUD/pivot operations driven purely by the relation config
 * (foreign/local keys for O2M, pivot model + parent/related keys for M2M), so it
 * does not depend on Sequelize associations being declared. This is the
 * behavioural port of the Laravel `ManagesRelations` trait.
 *
 * Single vs. bulk mode follows the original semantics: any `_scenario`
 * containing "bulk" triggers bulk behaviour.
 *
 * @author Charlietyn (TypeScript/Sequelize port)
 */
export class RelationManager {
  private readonly parentPk: string;

  constructor(
    private readonly parentModel: ModelStatic<Model>,
    private readonly restConfig: RestGenericConfig,
  ) {
    this.parentPk = parentModel.primaryKeyAttribute ?? 'id';
  }

  // ── Read ────────────────────────────────────────────────────────────────

  async list(config: ResolvedRelationConfig, parentId: unknown, params: FilterParams): Promise<unknown> {
    const parent = await this.resolveParent(config, parentId);
    return isManyToMany(config)
      ? this.listM2M(config, parent, params)
      : this.listO2M(config, parent, params);
  }

  async show(config: ResolvedRelationConfig, parentId: unknown, relatedId: unknown, params: FilterParams): Promise<unknown> {
    const parent = await this.resolveParent(config, parentId);
    const related = config.relatedModel;
    const pk = this.pkOf(related);
    const base = this.translator(related).buildFindOptions({ ...params, pagination: null, orderby: null });

    if (isManyToMany(config)) {
      await this.assertLinked(config, parent, relatedId);
      base.where = this.and(base.where, { [pk]: relatedId } as WhereOptions);
    } else {
      base.where = this.and(base.where, {
        [pk]: relatedId,
        [config.foreignKey]: this.localKeyValue(config, parent),
      } as WhereOptions);
    }
    const row = await related.findOne(base);
    if (!row) throw this.notFound(config, relatedId);
    return row;
  }

  private async listO2M(config: OneToManyConfig & { _type: 'o2m' }, parent: Model, params: FilterParams): Promise<unknown> {
    const related = config.relatedModel;
    const options = this.translator(related).buildFindOptions(params);
    options.where = this.and(options.where, { [config.foreignKey]: this.localKeyValue(config, parent) } as WhereOptions);
    return this.fetch(related, options, params);
  }

  private async listM2M(config: ManyToManyConfig & { _type: 'm2m' }, parent: Model, params: FilterParams): Promise<unknown> {
    const ids = await this.linkedIds(config, parent);
    if (!ids.length) return { data: [] };
    const related = config.relatedModel;
    const pk = this.pkOf(related);
    const options = this.translator(related).buildFindOptions(params);
    options.where = this.and(options.where, { [pk]: { [Op.in]: ids } } as WhereOptions);
    return this.fetch(related, options, params);
  }

  // ── Create / Update / Delete (shared) ─────────────────────────────────────

  async create(
    config: ResolvedRelationConfig,
    parentId: unknown,
    data: Record<string, unknown> | Record<string, unknown>[],
    bulk: boolean,
  ): Promise<WriteResult> {
    const parent = await this.resolveParent(config, parentId);
    const related = config.relatedModel;
    return this.tx(related, async (t) => {
      const list = bulk ? (data as Record<string, unknown>[]) : [data as Record<string, unknown>];
      const models: WriteResult[] = [];
      for (const item of list) {
        const payload = { ...item } as Record<string, unknown>;
        if (!isManyToMany(config)) payload[config.foreignKey] = this.localKeyValue(config, parent);
        const created = await related.create(payload as never, { transaction: t });
        if (isManyToMany(config)) {
          await this.attachPivot(config, parent, [{ id: created.get(this.pkOf(related)) }], t);
        }
        models.push({ success: true, model: created });
      }
      return bulk ? { success: true, models } : models[0];
    });
  }

  async update(
    config: ResolvedRelationConfig,
    parentId: unknown,
    relatedId: unknown,
    data: Record<string, unknown> | Record<string, unknown>[],
    bulk: boolean,
  ): Promise<WriteResult> {
    const parent = await this.resolveParent(config, parentId);
    const related = config.relatedModel;
    const pk = this.pkOf(related);
    return this.tx(related, async (t) => {
      if (bulk) {
        const list = data as Record<string, unknown>[];
        const models: WriteResult[] = [];
        const notFound: unknown[] = [];
        for (const item of list) {
          const id = item[pk] ?? item.id;
          // Scope every lookup to this parent, exactly like the single-record
          // path below: a bulk payload must never reach rows of another parent.
          const scoped = isManyToMany(config)
            ? ({ [pk]: id } as WhereOptions)
            : ({ [pk]: id, [config.foreignKey]: this.localKeyValue(config, parent) } as WhereOptions);
          if (isManyToMany(config) && !(await this.isLinked(config, parent, id, t))) {
            notFound.push(id);
            continue;
          }
          const inst = await related.findOne({ where: scoped, transaction: t });
          if (!inst) {
            notFound.push(id);
            continue;
          }
          await inst.update(item as never, { transaction: t });
          models.push({ success: true, model: inst });
        }
        const out: WriteResult = { success: notFound.length === 0, models };
        if (notFound.length) out.error = this.bulkNotFound(config, notFound);
        return out;
      }
      const where = isManyToMany(config)
        ? ({ [pk]: relatedId } as WhereOptions)
        : ({ [pk]: relatedId, [config.foreignKey]: this.localKeyValue(config, parent) } as WhereOptions);
      if (isManyToMany(config)) await this.assertLinked(config, parent, relatedId);
      const inst = await related.findOne({ where, transaction: t });
      if (!inst) throw this.notFound(config, relatedId);
      await inst.update(data as never, { transaction: t });
      return { success: true, model: inst };
    });
  }

  async delete(
    config: ResolvedRelationConfig,
    parentId: unknown,
    relatedId: unknown,
    data: Record<string, unknown> | unknown[],
    bulk: boolean,
  ): Promise<WriteResult> {
    const parent = await this.resolveParent(config, parentId);
    const related = config.relatedModel;
    const pk = this.pkOf(related);
    const deleteRelated = config.mutation?.deleteRelated ?? true;
    const m2m = isManyToMany(config);
    return this.tx(related, async (t) => {
      const ids = bulk ? this.idsFromBody(data) : [relatedId];
      if (!bulk && !m2m) {
        const inst = await related.findOne({
          where: { [pk]: relatedId, [(config as OneToManyConfig).foreignKey]: this.localKeyValue(config as OneToManyConfig, parent) } as WhereOptions,
          transaction: t,
        });
        if (!inst) throw this.notFound(config, relatedId);
        await inst.destroy({ transaction: t });
        return { success: true, model: inst };
      }
      // Bulk delete is scoped to this parent too: for O2M by the foreign key,
      // for M2M by the pivot links. Ids outside the relation are reported as
      // not-found instead of being deleted.
      let scoped: WhereOptions;
      if (m2m) {
        const linked = await this.linkedIds(config as ManyToManyConfig & { _type: 'm2m' }, parent, t);
        const allowed = ids.filter((id) => linked.some((l) => String(l) === String(id)));
        scoped = { [pk]: { [Op.in]: allowed } } as WhereOptions;
      } else {
        scoped = {
          [pk]: { [Op.in]: ids },
          [(config as OneToManyConfig).foreignKey]: this.localKeyValue(config as OneToManyConfig, parent),
        } as WhereOptions;
      }
      const found = await related.findAll({ where: scoped, transaction: t });
      const foundIds = found.map((r) => r.get(pk));
      const notFound = ids.filter((id) => !foundIds.some((f) => String(f) === String(id)));
      if (m2m) await this.detachPivot(config as ManyToManyConfig & { _type: 'm2m' }, parent, foundIds, t);
      if (deleteRelated && foundIds.length) {
        await related.destroy({ where: { [pk]: { [Op.in]: foundIds } } as WhereOptions, transaction: t });
      }
      const out: WriteResult = { success: notFound.length === 0, models: found.map((m) => ({ success: true, model: m })) };
      if (notFound.length) out.error = this.bulkNotFound(config, notFound);
      return out;
    });
  }

  // ── M2M-only: attach / detach / pivot ─────────────────────────────────────

  async attach(config: ResolvedRelationConfig, parentId: unknown, data: Record<string, unknown> | unknown[], scenario: string): Promise<unknown> {
    const m2m = this.assertM2M(config, 'attachRelation');
    const parent = await this.resolveParent(config, parentId);
    return this.tx(m2m.pivotModel, async (t) => {
      if (scenario.includes('sync')) return this.syncPivot(m2m, parent, data, t);
      if (scenario.includes('toggle')) return this.togglePivot(m2m, parent, data, t);
      const entries = this.pivotEntries(m2m, Array.isArray(data) ? data : [data]);
      await this.attachPivot(m2m, parent, entries, t);
      return { attached: entries.map((e) => e.id) };
    });
  }

  async detach(config: ResolvedRelationConfig, parentId: unknown, relatedId: unknown, data: Record<string, unknown> | unknown[], bulk: boolean): Promise<unknown> {
    const m2m = this.assertM2M(config, 'detachRelation');
    const parent = await this.resolveParent(config, parentId);
    const ids = bulk ? this.idsFromBody(data) : [relatedId];
    return this.tx(m2m.pivotModel, async (t) => {
      await this.detachPivot(m2m, parent, ids, t);
      return { detached: ids };
    });
  }

  async updatePivot(
    config: ResolvedRelationConfig,
    parentId: unknown,
    relatedId: unknown,
    data: Record<string, unknown> | Record<string, unknown>[],
    bulk: boolean,
  ): Promise<unknown> {
    const m2m = this.assertM2M(config, 'updatePivotRelation');
    const parent = await this.resolveParent(config, parentId);
    const pivot = m2m.pivotModel;
    const parentVal = parent.get(this.parentPk);
    return this.tx(m2m.pivotModel, async (t) => {
      if (bulk) {
        const results: unknown[] = [];
        for (const item of data as Record<string, unknown>[]) {
          const id = item[m2m.relatedKey] ?? item.id;
          if (id == null) continue;
          const pivotData = { ...item };
          delete pivotData[m2m.relatedKey];
          delete pivotData.id;
          await pivot.update(this.whitelistPivot(pivotData, m2m.mutation) as never, {
            where: { [m2m.parentKey]: parentVal, [m2m.relatedKey]: id } as WhereOptions,
            transaction: t,
          });
          results.push(await pivot.findOne({ where: { [m2m.parentKey]: parentVal, [m2m.relatedKey]: id } as WhereOptions, transaction: t }));
        }
        return results;
      }
      await pivot.update(this.whitelistPivot(data as Record<string, unknown>, m2m.mutation) as never, {
        where: { [m2m.parentKey]: parentVal, [m2m.relatedKey]: relatedId } as WhereOptions,
        transaction: t,
      });
      return pivot.findOne({ where: { [m2m.parentKey]: parentVal, [m2m.relatedKey]: relatedId } as WhereOptions, transaction: t });
    });
  }

  // ── Pivot primitives ──────────────────────────────────────────────────────

  private async linkedIds(config: ManyToManyConfig & { _type: 'm2m' }, parent: Model, t?: Transaction): Promise<unknown[]> {
    const rows = await config.pivotModel.findAll({
      where: { [config.parentKey]: parent.get(this.parentPk) } as WhereOptions,
      transaction: t,
    });
    return rows.map((r) => r.get(config.relatedKey));
  }

  /** True when `relatedId` is linked to `parent` through the pivot. */
  private async isLinked(config: ManyToManyConfig & { _type: 'm2m' }, parent: Model, relatedId: unknown, t?: Transaction): Promise<boolean> {
    const exists = await config.pivotModel.findOne({
      where: { [config.parentKey]: parent.get(this.parentPk), [config.relatedKey]: relatedId } as WhereOptions,
      transaction: t,
    });
    return exists !== null;
  }

  private async assertLinked(config: ManyToManyConfig & { _type: 'm2m' }, parent: Model, relatedId: unknown): Promise<void> {
    if (!(await this.isLinked(config, parent, relatedId))) throw this.notFound(config, relatedId);
  }

  private async attachPivot(
    config: ManyToManyConfig & { _type: 'm2m' },
    parent: Model,
    entries: { id: unknown; pivot?: Record<string, unknown> }[],
    t: Transaction,
  ): Promise<void> {
    const parentVal = parent.get(this.parentPk);
    for (const e of entries) {
      const existing = await config.pivotModel.findOne({
        where: { [config.parentKey]: parentVal, [config.relatedKey]: e.id } as WhereOptions,
        transaction: t,
      });
      if (existing) continue;
      const row = { [config.parentKey]: parentVal, [config.relatedKey]: e.id, ...this.whitelistPivot(e.pivot ?? {}, config.mutation) };
      await config.pivotModel.create(row as never, { transaction: t });
    }
  }

  private async detachPivot(config: ManyToManyConfig & { _type: 'm2m' }, parent: Model, ids: unknown[], t: Transaction): Promise<void> {
    if (!ids.length) return;
    await config.pivotModel.destroy({
      where: { [config.parentKey]: parent.get(this.parentPk), [config.relatedKey]: { [Op.in]: ids } } as WhereOptions,
      transaction: t,
    });
  }

  private async syncPivot(config: ManyToManyConfig & { _type: 'm2m' }, parent: Model, data: unknown, t: Transaction): Promise<unknown> {
    const entries = this.pivotEntries(config, data);
    const target = entries.map((e) => e.id);
    const current = await this.linkedIds(config, parent);
    const detached = current.filter((id) => !target.some((x) => String(x) === String(id)));
    const attached = target.filter((id) => !current.some((c) => String(c) === String(id)));
    await this.detachPivot(config, parent, detached, t);
    await this.attachPivot(config, parent, entries.filter((e) => attached.some((a) => String(a) === String(e.id))), t);
    return { attached, detached, updated: [] };
  }

  private async togglePivot(config: ManyToManyConfig & { _type: 'm2m' }, parent: Model, data: unknown, t: Transaction): Promise<unknown> {
    const entries = this.pivotEntries(config, data);
    const current = await this.linkedIds(config, parent);
    const toDetach = entries.filter((e) => current.some((c) => String(c) === String(e.id)));
    const toAttach = entries.filter((e) => !current.some((c) => String(c) === String(e.id)));
    await this.detachPivot(config, parent, toDetach.map((e) => e.id), t);
    await this.attachPivot(config, parent, toAttach, t);
    return { attached: toAttach.map((e) => e.id), detached: toDetach.map((e) => e.id) };
  }

  private pivotEntries(config: ManyToManyConfig & { _type: 'm2m' }, data: unknown): { id: unknown; pivot?: Record<string, unknown> }[] {
    if (Array.isArray(data)) {
      return data.map((item) => {
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const id = obj[config.relatedKey] ?? obj.id;
          const pivot = { ...obj };
          delete pivot[config.relatedKey];
          delete pivot.id;
          return { id, pivot };
        }
        return { id: item };
      });
    }
    if (data && typeof data === 'object') {
      return Object.entries(data as Record<string, unknown>).map(([id, pivot]) => ({
        id,
        pivot: pivot && typeof pivot === 'object' ? (pivot as Record<string, unknown>) : {},
      }));
    }
    return [];
  }

  private whitelistPivot(pivot: Record<string, unknown>, mutation?: RelationMutationConfig): Record<string, unknown> {
    const allowed = mutation?.pivotColumns;
    if (!allowed?.length) return pivot;
    return Object.fromEntries(Object.entries(pivot).filter(([k]) => allowed.includes(k)));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async fetch(model: ModelStatic<Model>, options: FindOptions, params: FilterParams): Promise<unknown> {
    const pagination = maybeJson<PaginationParams>(params.pagination);
    if (pagination) {
      const pageSize = pagination.pageSize ?? pagination.pagesize ?? 15;
      const page = pagination.page ?? 1;
      const { rows, count } = await model.findAndCountAll({ ...options, distinct: true, offset: (page - 1) * pageSize, limit: pageSize });
      const total = typeof count === 'number' ? count : (count as { length: number }).length;
      return {
        current_page: page,
        data: rows,
        per_page: pageSize,
        total,
        last_page: Math.ceil(total / pageSize) || 1,
        from: total > 0 ? (page - 1) * pageSize + 1 : null,
        to: total > 0 ? Math.min(page * pageSize, total) : null,
      };
    }
    return { data: await model.findAll(options) };
  }

  private async resolveParent(config: ResolvedRelationConfig, parentId: unknown): Promise<Model> {
    if (parentId == null) throw new BadRequestException('A parent id is required to resolve this relation.');
    const parent = await this.parentModel.findByPk(parentId as never);
    if (!parent) throw new NotFoundException(`${config.parentModel.name} with id ${String(parentId)} not found.`);
    return parent;
  }

  /**
   * Runs a unit of work transactionally on the Sequelize instance of the model
   * being written (related or pivot), NOT the parent's — cross-connection writes
   * cannot share the parent's transaction. With a single connection every model
   * shares one Sequelize instance, so behaviour is unchanged.
   */
  private tx<R>(model: ModelStatic<Model>, work: (t: Transaction) => Promise<R>): Promise<R> {
    const sequelize = model.sequelize;
    if (!sequelize) throw new Error('Model is not attached to a Sequelize instance.');
    return sequelize.transaction(work);
  }

  private translator(model: ModelStatic<Model>): SequelizeQueryTranslator {
    return new SequelizeQueryTranslator(model, this.restConfig);
  }

  private pkOf(model: ModelStatic<Model>): string {
    return model.primaryKeyAttribute ?? 'id';
  }

  private localKeyValue(config: OneToManyConfig, parent: Model): unknown {
    return parent.get(config.localKey ?? this.parentPk);
  }

  private idsFromBody(data: Record<string, unknown> | unknown[]): unknown[] {
    if (Array.isArray(data)) return data.map((d) => (d && typeof d === 'object' ? (d as Record<string, unknown>).id ?? d : d));
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj.ids)) return obj.ids as unknown[];
      return Object.values(obj);
    }
    return [];
  }

  private assertM2M(config: ResolvedRelationConfig, method: string): ManyToManyConfig & { _type: 'm2m' } {
    if (!isManyToMany(config)) {
      throw new BadRequestException(`${method}() can only be used with many-to-many relations. Configure the relation in manyToManyConfig.`);
    }
    return config;
  }

  private notFound(config: ResolvedRelationConfig, id: unknown): NotFoundException {
    return new NotFoundException(`${config.relatedModel.name} with id ${String(id)} not found in this relation.`);
  }

  private bulkNotFound(config: ResolvedRelationConfig, ids: unknown[]): Record<string, unknown> {
    return { message: `${ids.length} ${config.relatedModel.name} record(s) not found: [${ids.join(', ')}]`, not_found_ids: ids };
  }

  private and(existing: WhereOptions | undefined, extra: WhereOptions): WhereOptions {
    if (!existing) return extra;
    return { [Op.and]: [existing, extra] } as WhereOptions;
  }
}
