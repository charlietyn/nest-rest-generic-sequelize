import { BadRequestException } from '@nestjs/common';
import {
  Op,
  Order,
  WhereOptions,
  fn,
  col,
  where as sqWhere,
  literal,
} from 'sequelize';
import type { IncludeOptions, FindOptions, ModelStatic, Model, Association } from 'sequelize';
import { RestGenericConfig } from '../config/rest-generic.config';
import { FilterParams, OperNode } from '../interfaces/filter-params.interface';
import {
  decodeValue,
  maybeJson,
  parseConditionString,
  toBetweenArray,
} from './condition.parser';
import { getDeclaredRelations } from '../base/base.model';
import { normalizeRelations, ParsedRelation } from './relations.parser';

/**
 * Translates the universal `FilterParams` into Sequelize `FindOptions`.
 *
 * Sequelize's operator symbols (`Op`) map directly onto the `oper` grammar, so
 * arbitrary AND/OR nesting is expressed natively (no DNF needed). Relation
 * sub-filters become `include` entries with `required: true` — the precise
 * analogue of Eloquent's `whereHas` — while eager-loading relations from the
 * `relations` param become `include` entries with field selection.
 *
 * @author Charlietyn (TypeScript/Sequelize port)
 */
export class SequelizeQueryTranslator {
  private readonly dialect: string;

  constructor(
    private readonly model: ModelStatic<Model>,
    private readonly config: RestGenericConfig,
  ) {
    this.dialect = model.sequelize?.getDialect() ?? 'postgres';
  }

  buildFindOptions(params: FilterParams): FindOptions {
    const operNode = this.normalizeOper(params.oper);
    if (operNode) this.assertConditionCount(operNode);

    const relationFilters: Record<string, OperNode> = {};
    if (operNode) this.collectRelationFilters(operNode, '', relationFilters, this.model);

    const baseWhere = operNode ? this.translateWhere(operNode, this.model, 0) : undefined;
    const attrWhere = this.translateAttr(params.attr);
    const where = this.combineAnd([baseWhere, attrWhere]);

    const include = this.buildInclude(params, relationFilters);
    const order = this.buildOrder(params.orderby);
    const attributes = this.buildAttributes(params.select);

    const options: FindOptions = {};
    if (where) options.where = where;
    if (include.length) options.include = include;
    if (order.length) options.order = order as Order;
    if (attributes) options.attributes = attributes;
    if (params.soft_delete === false || params.soft_delete === true) options.paranoid = false;
    return options;
  }

  // ---------------------------------------------------------------------------
  // WHERE
  // ---------------------------------------------------------------------------

  /** Build a Sequelize where from an oper node (relation keys are ignored here). */
  private translateWhere(node: OperNode, model: ModelStatic<Model>, depth: number): WhereOptions | undefined {
    if (depth > this.config.filtering.maxDepth) {
      throw new BadRequestException(`Maximum nesting depth (${this.config.filtering.maxDepth}) exceeded.`);
    }
    const groups: WhereOptions[] = [];

    if (node.and !== undefined) {
      const items = this.translateList(node.and, model, depth);
      if (items.length) groups.push({ [Op.and]: items } as WhereOptions);
    }
    if (node.or !== undefined) {
      const items = this.translateList(node.or, model, depth);
      if (items.length) groups.push({ [Op.or]: items } as WhereOptions);
    }

    if (!groups.length) return undefined;
    return groups.length === 1 ? groups[0] : ({ [Op.and]: groups } as WhereOptions);
  }

  private translateList(list: unknown, model: ModelStatic<Model>, depth: number): WhereOptions[] {
    const items = Array.isArray(list) ? list : [list];
    const out: WhereOptions[] = [];
    for (const item of items) {
      if (typeof item === 'string') {
        out.push(this.translateLeaf(item));
      } else if (item && typeof item === 'object') {
        // A nested logical node; relation keys inside are handled separately.
        const w = this.translateWhere(item as OperNode, model, depth + 1);
        if (w) out.push(w);
      }
    }
    return out;
  }

  private translateLeaf(condition: string): WhereOptions {
    const { field, operator, value } = parseConditionString(condition);
    const op = operator.toLowerCase().trim();
    if (!this.config.filtering.allowedOperators.includes(op)) {
      throw new BadRequestException(`The ${operator} value is not a valid operator.`);
    }
    const decoded = decodeValue(value);
    const column = field.includes('.') ? `$${field}$` : field;

    switch (op) {
      case '=':
        return decoded === null ? ({ [column]: { [Op.is]: null } } as WhereOptions) : ({ [column]: { [Op.eq]: decoded } } as WhereOptions);
      case '!=':
      case '<>':
        return decoded === null ? ({ [column]: { [Op.not]: null } } as WhereOptions) : ({ [column]: { [Op.ne]: decoded } } as WhereOptions);
      case '<':
        return { [column]: { [Op.lt]: decoded } } as WhereOptions;
      case '>':
        return { [column]: { [Op.gt]: decoded } } as WhereOptions;
      case '<=':
        return { [column]: { [Op.lte]: decoded } } as WhereOptions;
      case '>=':
        return { [column]: { [Op.gte]: decoded } } as WhereOptions;
      case 'like':
        return { [column]: { [Op.like]: decoded } } as WhereOptions;
      case 'not like':
        return { [column]: { [Op.notLike]: decoded } } as WhereOptions;
      case 'ilike':
      case 'ilikeu':
        return this.dialect === 'postgres'
          ? ({ [column]: { [Op.iLike]: decoded } } as WhereOptions)
          : ({ [column]: { [Op.like]: decoded } } as WhereOptions);
      case 'not ilike':
        return this.dialect === 'postgres'
          ? ({ [column]: { [Op.notILike]: decoded } } as WhereOptions)
          : ({ [column]: { [Op.notLike]: decoded } } as WhereOptions);
      case 'in':
        return { [column]: { [Op.in]: this.toArray(decoded) } } as WhereOptions;
      case 'not in':
      case 'notin':
        return { [column]: { [Op.notIn]: this.toArray(decoded) } } as WhereOptions;
      case 'between': {
        const [a, b] = toBetweenArray(decoded);
        return { [column]: { [Op.between]: [a, b] } } as WhereOptions;
      }
      case 'not between':
      case 'notbetween': {
        const [a, b] = toBetweenArray(decoded);
        return { [column]: { [Op.notBetween]: [a, b] } } as WhereOptions;
      }
      case 'null':
        return { [column]: { [Op.is]: null } } as WhereOptions;
      case 'not null':
      case 'notnull':
        return { [column]: { [Op.not]: null } } as WhereOptions;
      case 'date':
        return sqWhere(fn('DATE', col(field)), decoded as string) as unknown as WhereOptions;
      case 'not date':
      case 'notdate':
        return sqWhere(fn('DATE', col(field)), { [Op.ne]: decoded } as object) as unknown as WhereOptions;
      case 'regexp':
        return { [column]: { [Op.regexp]: decoded } } as WhereOptions;
      case 'not regexp':
        return { [column]: { [Op.notRegexp]: decoded } } as WhereOptions;
      default:
        throw new BadRequestException(`The ${op} value is not a valid operator.`);
    }
  }

  private translateAttr(attr: FilterParams['attr']): WhereOptions | undefined {
    if (!attr) return undefined;
    const obj = typeof attr === 'string' ? maybeJson<Record<string, unknown>>(attr) : attr;
    if (!obj || typeof obj !== 'object') return undefined;
    const where: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      where[k] = Array.isArray(v) ? { [Op.in]: v } : v;
    }
    return Object.keys(where).length ? (where as WhereOptions) : undefined;
  }

  // ---------------------------------------------------------------------------
  // INCLUDE (relations: eager-load + field selection + whereHas filters)
  // ---------------------------------------------------------------------------

  private buildInclude(
    params: FilterParams,
    relationFilters: Record<string, OperNode>,
  ): IncludeOptions[] {
    const allowed = getDeclaredRelations(this.model);
    const roots = new Map<string, IncludeNode>();

    // 1. Eager loads from `relations`.
    for (const rel of normalizeRelations(params.relations, allowed)) {
      this.validateBase(rel, allowed);
      this.mergePath(roots, rel.segments, this.model, { fields: rel.fields, required: false });
    }

    // 2. whereHas filters from `oper`.
    for (const [path, subOper] of Object.entries(relationFilters)) {
      const segments = path.split('.');
      this.validateBase({ base: segments[0] } as ParsedRelation, allowed);
      this.mergePath(roots, segments, this.model, { filter: subOper, required: true });
    }

    return [...roots.values()].map((n) => this.toIncludeOptions(n));
  }

  private mergePath(
    level: Map<string, IncludeNode>,
    segments: string[],
    parentModel: ModelStatic<Model>,
    leaf: { fields?: string[] | null; filter?: OperNode; required?: boolean },
  ): void {
    const [head, ...rest] = segments;
    const assoc = this.resolveAssociation(parentModel, head);
    const target = assoc.target as ModelStatic<Model>;

    let node = level.get(head);
    if (!node) {
      node = { as: head, model: target, children: new Map(), required: false };
      level.set(head, node);
    }
    if (leaf.required) node.required = true;

    if (rest.length === 0) {
      if (leaf.fields && leaf.fields.length) node.attributes = leaf.fields;
      if (leaf.filter) {
        const w = this.translateWhere(leaf.filter, target, 0);
        if (w) node.where = w;
        node.required = true;
      }
    } else {
      this.mergePath(node.children, rest, target, leaf);
    }
  }

  private toIncludeOptions(node: IncludeNode): IncludeOptions {
    const opt: IncludeOptions = { model: node.model, as: node.as };
    if (node.attributes) opt.attributes = node.attributes;
    if (node.where) opt.where = node.where;
    if (node.required) opt.required = true;
    const children = [...node.children.values()];
    if (children.length) opt.include = children.map((c) => this.toIncludeOptions(c));
    return opt;
  }

  // ---------------------------------------------------------------------------
  // ORDER
  // ---------------------------------------------------------------------------

  private buildOrder(orderby: FilterParams['orderby']): unknown[] {
    const order: unknown[] = [];
    let entries = maybeJson<unknown>(orderby);
    if (!Array.isArray(entries)) entries = entries ? [entries] : [];

    for (const entry of entries as unknown[]) {
      const obj = typeof entry === 'string' ? maybeJson(entry) : entry;
      if (!obj || typeof obj !== 'object') continue;
      for (const [column, dirRaw] of Object.entries(obj as Record<string, unknown>)) {
        const dir = String(dirRaw).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
        if (!column.includes('.')) {
          (order as unknown[]).push([column, dir]);
          continue;
        }
        // Relation-path ordering: resolve each segment to a {model, as} ref.
        const segments = column.split('.');
        const finalCol = segments.pop()!;
        const refs: unknown[] = [];
        let parent: ModelStatic<Model> = this.model;
        for (const seg of segments) {
          const assoc = this.resolveAssociation(parent, seg);
          refs.push({ model: assoc.target, as: seg });
          parent = assoc.target as ModelStatic<Model>;
        }
        (order as unknown[]).push([...refs, finalCol, dir]);
      }
    }
    return order;
  }

  // ---------------------------------------------------------------------------
  // SELECT
  // ---------------------------------------------------------------------------

  private buildAttributes(select: FilterParams['select']): string[] | undefined {
    if (select === undefined || select === null || select === '*') return undefined;
    if (typeof select === 'string') {
      const decoded = maybeJson(select);
      if (Array.isArray(decoded)) return decoded as string[];
      return select === '' ? undefined : select.split(',').map((s) => s.trim());
    }
    if (Array.isArray(select)) {
      if (select.length === 1 && select[0] === '*') return undefined;
      return select;
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  normalizeOper(oper: unknown): OperNode | null {
    if (oper === null || oper === undefined || oper === '') return null;
    let node: unknown = typeof oper === 'string' ? maybeJson(oper) : oper;
    if (Array.isArray(node)) node = { and: node };
    if (!node || typeof node !== 'object') return null;
    return node as OperNode;
  }

  /** Recursively gather relation-keyed sub-filters (any non and/or object key). */
  private collectRelationFilters(
    node: OperNode,
    prefix: string,
    out: Record<string, OperNode>,
    model: ModelStatic<Model>,
  ): void {
    for (const [key, value] of Object.entries(node)) {
      if (value === undefined) continue;
      if (key === 'and' || key === 'or') {
        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
          if (item && typeof item === 'object') {
            this.collectRelationFilters(item as OperNode, prefix, out, model);
          }
        }
      } else if (value && typeof value === 'object') {
        const path = prefix ? `${prefix}.${key}` : key;
        out[path] = value as OperNode;
      }
    }
  }

  private resolveAssociation(model: ModelStatic<Model>, alias: string): Association {
    const assoc = (model.associations as Record<string, Association>)[alias];
    if (!assoc) {
      throw new BadRequestException(`Relation '${alias}' does not exist on model ${model.name}.`);
    }
    return assoc;
  }

  private validateBase(rel: { base: string }, allowed: string[]): void {
    if (this.config.filtering.strictRelations && !allowed.includes(rel.base)) {
      throw new BadRequestException(
        `Relation '${rel.base}' is not allowed. Allowed: ${allowed.join(', ')}`,
      );
    }
  }

  private combineAnd(parts: (WhereOptions | undefined)[]): WhereOptions | undefined {
    const present = parts.filter((p): p is WhereOptions => p !== undefined);
    if (!present.length) return undefined;
    return present.length === 1 ? present[0] : ({ [Op.and]: present } as WhereOptions);
  }

  private assertConditionCount(node: OperNode): void {
    let count = 0;
    const walk = (n: unknown): void => {
      if (typeof n === 'string') count++;
      else if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === 'object') Object.values(n).forEach(walk);
    };
    walk(node);
    if (count > this.config.filtering.maxConditions) {
      throw new BadRequestException(`Maximum conditions (${this.config.filtering.maxConditions}) exceeded.`);
    }
  }

  private toArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [value];
  }
}

interface IncludeNode {
  as: string;
  model: ModelStatic<Model>;
  attributes?: string[];
  where?: WhereOptions;
  required: boolean;
  children: Map<string, IncludeNode>;
}

// Keep `literal` referenced for advanced consumers / future raw ordering.
export const __sequelizeLiteral = literal;
