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

class CategorySvc extends BaseService<Category> {}
class ProductSvc extends BaseService<Product> {}

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

/**
 * Bulk relation routes must stay scoped to their parent: a payload sent to
 * `/parent/1/relation/bulk` may never read, update or delete rows that belong
 * to parent 2.
 */
describe('nest-rest-generic-sequelize · RelationManager parent scoping', () => {
  let sequelize: Sequelize;
  let categorySvc: CategorySvc;
  let productSvc: ProductSvc;
  let phonesId: number;
  let laptopsId: number;
  let mineId: number;
  let foreignId: number;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
      models: [Product, Category, Tag, ProductTag],
    });
    await sequelize.sync({ force: true });
    categorySvc = new CategorySvc(Category, DEFAULT_CONFIG);
    productSvc = new ProductSvc(Product, DEFAULT_CONFIG);

    phonesId = (await Category.create({ name: 'Phones', parent_id: null } as never)).get('id') as number;
    laptopsId = (await Category.create({ name: 'Laptops', parent_id: null } as never)).get('id') as number;
    mineId = (await Product.create({ name: 'iPhone', price: 999, status: 'active', category_id: phonesId } as never)).get('id') as number;
    foreignId = (await Product.create({ name: 'MacBook', price: 2499, status: 'active', category_id: laptopsId } as never)).get('id') as number;
    await Tag.bulkCreate([{ name: 'new' }, { name: 'sale' }] as never);
  });

  afterEach(async () => sequelize.close());

  it('O2M bulk update does not touch a row belonging to another parent', async () => {
    const res = await categorySvc.updateRelation(
      o2m,
      phonesId,
      null,
      [
        { id: mineId, name: 'iPhone Pro' },
        { id: foreignId, name: 'HACKED' },
      ],
      true,
    );

    expect(res.success).toBe(false);
    expect((res.error as { not_found_ids: unknown[] }).not_found_ids).toEqual([foreignId]);
    expect((await Product.findByPk(mineId))?.get('name')).toBe('iPhone Pro');
    expect((await Product.findByPk(foreignId))?.get('name')).toBe('MacBook');
  });

  it('O2M bulk delete does not delete a row belonging to another parent', async () => {
    const res = await categorySvc.deleteRelation(o2m, phonesId, null, { ids: [mineId, foreignId] }, true);

    expect(res.success).toBe(false);
    expect((res.error as { not_found_ids: unknown[] }).not_found_ids).toEqual([foreignId]);
    expect(await Product.findByPk(mineId)).toBeNull();
    expect(await Product.findByPk(foreignId)).not.toBeNull();
  });

  it('M2M bulk update only reaches rows linked to this parent', async () => {
    await productSvc.attachRelation(m2m, mineId, [{ tag_id: 1 }], 'bulk_attach');

    const res = await productSvc.updateRelation(
      m2m,
      mineId,
      null,
      [
        { id: 1, name: 'renamed' },
        { id: 2, name: 'HACKED' },
      ],
      true,
    );

    expect(res.success).toBe(false);
    expect((res.error as { not_found_ids: unknown[] }).not_found_ids).toEqual([2]);
    expect((await Tag.findByPk(1))?.get('name')).toBe('renamed');
    expect((await Tag.findByPk(2))?.get('name')).toBe('sale');
  });

  it('M2M bulk delete only detaches ids linked to this parent', async () => {
    await productSvc.attachRelation(m2m, mineId, [{ tag_id: 1 }], 'bulk_attach');
    await productSvc.attachRelation(m2m, foreignId, [{ tag_id: 2 }], 'bulk_attach');

    const res = await productSvc.deleteRelation(m2m, mineId, null, { ids: [1, 2] }, true);

    expect(res.success).toBe(false);
    expect((res.error as { not_found_ids: unknown[] }).not_found_ids).toEqual([2]);
    // The other parent keeps its link intact.
    expect(await ProductTag.findOne({ where: { product_id: foreignId, tag_id: 2 } })).not.toBeNull();
    expect(await ProductTag.findOne({ where: { product_id: mineId, tag_id: 1 } })).toBeNull();
  });
});
