import 'reflect-metadata';
import { Sequelize, Table, Column, DataType } from 'sequelize-typescript';
import { BaseModel } from '../src/base/base.model';
import { BaseService } from '../src/base/base.service';
import { RgcCacheService, RgcCacheStore } from '../src/cache/cache.service';
import { DEFAULT_CONFIG } from '../src/config/rest-generic.config';
import { OneToManyConfig, ResolvedRelationConfig } from '../src/relations/relation-config';
import { Product } from '../src/example/product.model';
import { Category } from '../src/example/category.model';

@Table({ tableName: 'tags', timestamps: false })
class Tag extends BaseModel {
  static readonly MODEL = 'tag';
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true }) id!: number;
  @Column(DataType.STRING) name!: string;
}

class InMemoryStore implements RgcCacheStore {
  private readonly data = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }
  set(key: string, value: unknown): void {
    this.data.set(key, value);
  }
  del(key: string): void {
    this.data.delete(key);
  }
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

/**
 * Every successful write must bump the model's cache version — including the
 * two paths that previously did not: a partially-successful `update_multiple`
 * and any write that goes through the relation manager.
 */
describe('nest-rest-generic-sequelize · write cache invalidation', () => {
  let sequelize: Sequelize;
  let cache: RgcCacheService;
  let productSvc: ProductSvc;
  let categorySvc: CategorySvc;
  let categoryId: number;
  let productId: number;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
      models: [Product, Category, Tag],
    });
    await sequelize.sync({ force: true });
    cache = new RgcCacheService(new InMemoryStore(), { ...DEFAULT_CONFIG.cache, enabled: true });
    productSvc = new ProductSvc(Product, DEFAULT_CONFIG, cache);
    categorySvc = new CategorySvc(Category, DEFAULT_CONFIG, cache);

    categoryId = (await Category.create({ name: 'Phones', parent_id: null } as never)).get('id') as number;
    productId = (await Product.create({ name: 'iPhone', price: 999, status: 'active', category_id: categoryId } as never)).get('id') as number;
  });

  afterEach(async () => sequelize.close());

  it('update_multiple bumps the version even when only some rows were found', async () => {
    const before = await cache.getVersion('product');

    const res = await productSvc.update_multiple([
      { id: productId, name: 'iPhone Pro' },
      { id: 999_999, name: 'ghost' },
    ]);

    expect(res.success).toBe(false); // one row was missing
    expect((await Product.findByPk(productId))?.get('name')).toBe('iPhone Pro'); // but this one committed
    expect(await cache.getVersion('product')).toBe(before + 1); // so the cache must not serve the old value
  });

  it('destroybyid runs inside a transaction and bumps the version', async () => {
    const before = await cache.getVersion('product');
    const res = await productSvc.destroybyid([productId]);

    expect(res.success).toBe(true);
    expect(await Product.findByPk(productId)).toBeNull();
    expect(await cache.getVersion('product')).toBe(before + 1);
  });

  it('a relation write bumps both the parent and the related model version', async () => {
    const parentBefore = await cache.getVersion('category');
    const relatedBefore = await cache.getVersion('product');

    await categorySvc.createRelation(o2m, categoryId, { name: 'Pixel', price: 799 }, false);

    expect(await cache.getVersion('category')).toBe(parentBefore + 1);
    expect(await cache.getVersion('product')).toBe(relatedBefore + 1);
  });

  it('a list cached before a relation write is not served stale afterwards', async () => {
    const first = (await productSvc.list_all({})) as { data: unknown[] };
    expect(first.data).toHaveLength(1); // now cached under the current version

    // Written through the relation manager, not through ProductSvc itself.
    await categorySvc.createRelation(o2m, categoryId, { name: 'Pixel', price: 799 }, false);

    const second = (await productSvc.list_all({})) as { data: unknown[] };
    expect(second.data).toHaveLength(2); // recomputed, not the stale 1-row entry
  });
});
