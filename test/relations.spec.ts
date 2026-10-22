import 'reflect-metadata';
import { Sequelize, Table, Column, DataType } from 'sequelize-typescript';
import { BaseModel } from '../src/base/base.model';
import { BaseService } from '../src/base/base.service';
import { DEFAULT_CONFIG } from '../src/config/rest-generic.config';
import {
  ManyToManyConfig,
  OneToManyConfig,
  ResolvedRelationConfig,
} from '../src/relations/relation-config';
import { Product } from '../src/example/product.model';
import { Category } from '../src/example/category.model';

@Table({ tableName: 'tags', timestamps: false })
class Tag extends BaseModel {
  static readonly MODEL = 'tag';
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true }) id!: number;
  @Column(DataType.STRING) name!: string;
}

@Table({ tableName: 'product_tags', timestamps: false })
class ProductTag extends BaseModel {
  static readonly MODEL = 'product_tag';
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true }) id!: number;
  @Column(DataType.INTEGER) product_id!: number;
  @Column(DataType.INTEGER) tag_id!: number;
  @Column({ type: DataType.STRING, allowNull: true }) note!: string | null;
}

class ProductSvc extends BaseService<Product> {}
class CategorySvc extends BaseService<Category> {}

const o2m: ResolvedRelationConfig = {
  _type: 'o2m',
  relationship: 'products',
  relatedModel: Product,
  parentModel: Category,
  foreignKey: 'category_id',
  localKey: 'id',
  mutation: { dataKey: ['products'], deleteRelated: true },
} as OneToManyConfig & { _type: 'o2m' };

const m2m: ResolvedRelationConfig = {
  _type: 'm2m',
  relationship: 'tags',
  relatedModel: Tag,
  parentModel: Product,
  pivotModel: ProductTag,
  parentKey: 'product_id',
  relatedKey: 'tag_id',
  mutation: { dataKey: ['tags'], deleteRelated: false, pivotColumns: ['note'] },
} as ManyToManyConfig & { _type: 'm2m' };

const ids = (rows: unknown[]): unknown[] => rows.map((r) => (r as { get: (k: string) => unknown }).get('id'));
const names = (rows: unknown[]): unknown[] => rows.map((r) => (r as { get: (k: string) => unknown }).get('name'));

describe('nest-rest-generic-sequelize · RelationManager', () => {
  let sequelize: Sequelize;
  let categorySvc: CategorySvc;
  let productSvc: ProductSvc;
  let phonesId: number;
  let iphoneId: number;

  beforeAll(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
      models: [Product, Category, Tag, ProductTag],
    });
    await sequelize.sync({ force: true });
    categorySvc = new CategorySvc(Category, DEFAULT_CONFIG);
    productSvc = new ProductSvc(Product, DEFAULT_CONFIG);

    const phones = await Category.create({ name: 'Phones', parent_id: null } as never);
    phonesId = phones.get('id') as number;
    const iphone = await Product.create({ name: 'iPhone', price: 999, status: 'active', category_id: phonesId } as never);
    iphoneId = iphone.get('id') as number;
    await Tag.bulkCreate([{ name: 'new' }, { name: 'sale' }, { name: 'hot' }] as never);
  });

  afterAll(async () => sequelize.close());

  it('O2M: lists related rows scoped to the parent', async () => {
    const res = (await categorySvc.listRelation(o2m, phonesId, {})) as { data: unknown[] };
    expect(names(res.data)).toEqual(['iPhone']);
  });

  it('O2M: creates a related row with the FK set automatically', async () => {
    const res = await categorySvc.createRelation(o2m, phonesId, { name: 'Pixel', price: 799 }, false);
    expect(res.success).toBe(true);
    const list = (await categorySvc.listRelation(o2m, phonesId, {})) as { data: unknown[] };
    expect((names(list.data) as string[]).sort()).toEqual(['Pixel', 'iPhone']);
  });

  it('O2M: bulk create + filtered list via oper', async () => {
    await categorySvc.createRelation(o2m, phonesId, [{ name: 'Cheap', price: 10 }, { name: 'Mid', price: 300 }], true);
    const res = (await categorySvc.listRelation(o2m, phonesId, { oper: { and: ['price|>=|300'] } })) as { data: unknown[] };
    expect((names(res.data) as string[]).sort()).toEqual(['Mid', 'Pixel', 'iPhone']);
  });

  it('M2M: attach (single + bulk) with pivot whitelist, then list', async () => {
    await productSvc.attachRelation(m2m, iphoneId, { tag_id: 1, note: 'keep', dropme: 'x' }, 'attach');
    await productSvc.attachRelation(m2m, iphoneId, [{ tag_id: 2 }, { tag_id: 3 }], 'bulk_attach');
    const res = (await productSvc.listRelation(m2m, iphoneId, {})) as { data: unknown[] };
    expect((ids(res.data) as number[]).sort()).toEqual([1, 2, 3]);
    const pivot = await ProductTag.findOne({ where: { product_id: iphoneId, tag_id: 1 } });
    expect(pivot?.get('note')).toBe('keep');
    expect(pivot?.get('dropme' as never)).toBeUndefined();
  });

  it('M2M: sync replaces the set', async () => {
    await productSvc.attachRelation(m2m, iphoneId, [1, 2], 'sync');
    const res = (await productSvc.listRelation(m2m, iphoneId, {})) as { data: unknown[] };
    expect((ids(res.data) as number[]).sort()).toEqual([1, 2]);
  });

  it('M2M: detach removes the pivot but not the related row', async () => {
    await productSvc.detachRelation(m2m, iphoneId, 1, [], false);
    const res = (await productSvc.listRelation(m2m, iphoneId, {})) as { data: unknown[] };
    expect(ids(res.data)).toEqual([2]);
    expect(await Tag.findByPk(1)).not.toBeNull();
  });

  it('actionValidate returns success by default', async () => {
    expect((await productSvc.actionValidate('create', { name: 'x' })).success).toBe(true);
  });
});
