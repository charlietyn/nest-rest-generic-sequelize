import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { Product } from '../src/example/product.model';
import { Category } from '../src/example/category.model';
import { BaseService } from '../src/base/base.service';
import { DEFAULT_CONFIG } from '../src/config/rest-generic.config';
import { DataResult, PaginatedResult } from '../src/interfaces/service-result.interface';

class ProductSvc extends BaseService<Product> {}
class CategorySvc extends BaseService<Category> {}

describe('nest-rest-generic-sequelize · BaseService', () => {
  let sequelize: Sequelize;
  let products: ProductSvc;
  let categories: CategorySvc;

  beforeAll(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
      models: [Product, Category],
    });
    await sequelize.sync({ force: true });

    products = new ProductSvc(Product, DEFAULT_CONFIG);
    categories = new CategorySvc(Category, DEFAULT_CONFIG);

    const electronics = await Category.create({ name: 'Electronics', parent_id: null } as never);
    const phones = await Category.create({ name: 'Phones', parent_id: electronics.get('id') } as never);
    await Category.create({ name: 'Laptops', parent_id: electronics.get('id') } as never);

    const phoneId = phones.get('id');
    await Product.bulkCreate([
      { name: 'iPhone', price: 999, status: 'active', category_id: phoneId },
      { name: 'Pixel', price: 799, status: 'active', category_id: phoneId },
      { name: 'Cheap Phone', price: 49, status: 'inactive', category_id: phoneId },
    ] as never);
  });

  afterAll(async () => sequelize.close());

  const toPlain = (rows: unknown[]): Record<string, unknown>[] =>
    rows.map((r) =>
      typeof (r as { toJSON?: () => unknown }).toJSON === 'function'
        ? (r as { toJSON: () => Record<string, unknown> }).toJSON()
        : (r as Record<string, unknown>),
    );

  it('filters with oper (and / >=)', async () => {
    const res = (await products.list_all({ oper: { and: ['price|>=|500'] } })) as DataResult<Product[]>;
    const names = toPlain(res.data).map((p) => p.name).sort();
    expect(names).toEqual(['Pixel', 'iPhone']);
  });

  it('filters with or', async () => {
    const res = (await products.list_all({ oper: { or: ['name|=|iPhone', 'name|=|Pixel'] } })) as DataResult<Product[]>;
    expect(res.data).toHaveLength(2);
  });

  it('supports in operator', async () => {
    const res = (await products.list_all({ oper: { and: ['status|in|active'] } })) as DataResult<Product[]>;
    expect(res.data).toHaveLength(2);
  });

  it('filters by relation (whereHas style)', async () => {
    const res = (await products.list_all({
      oper: { category: { and: ['name|=|Phones'] } },
      relations: ['category'],
    })) as DataResult<Product[]>;
    expect(res.data).toHaveLength(3);
  });

  it('orders results', async () => {
    const res = (await products.list_all({ orderby: [{ price: 'desc' }] })) as DataResult<Product[]>;
    expect(toPlain(res.data).map((p) => p.name)).toEqual(['iPhone', 'Pixel', 'Cheap Phone']);
  });

  it('paginates', async () => {
    const res = (await products.list_all({ pagination: { page: 1, pageSize: 2 } })) as PaginatedResult<Product>;
    expect(res.data).toHaveLength(2);
    expect(res.total).toBe(3);
    expect(res.last_page).toBe(2);
  });

  it('creates (single)', async () => {
    const res = await products.create({ name: 'Watch', price: 399, status: 'active' });
    expect(res.success).toBe(true);
  });

  it('creates in bulk via {product: [...]}', async () => {
    const res = await products.create({ product: [{ name: 'A', price: 1 }, { name: 'B', price: 2 }] });
    expect(res.success).toBe(true);
    expect(res.models).toHaveLength(2);
  });

  it('updates by id', async () => {
    const created = await products.create({ name: 'ToEdit', price: 10 });
    const id = (created.model as Product).get('id');
    const res = await products.update({ price: 20 }, id);
    expect(Number((res.model as Product).get('price'))).toBe(20);
  });

  it('destroys by id', async () => {
    const created = await products.create({ name: 'ToDelete', price: 10 });
    const id = (created.model as Product).get('id');
    const res = await products.destroy(id);
    expect(res.success).toBe(true);
  });

  it('builds hierarchy with descendants', async () => {
    const res = (await categories.list_all({
      hierarchy: { filter_mode: 'with_descendants', children_key: 'children' },
      oper: { and: ['name|=|Electronics'] },
    })) as DataResult<Record<string, unknown>[]>;
    expect(res.data).toHaveLength(1);
    const root = res.data[0];
    expect(root.name).toBe('Electronics');
    expect((root.children as unknown[]).length).toBe(2);
  });
});
