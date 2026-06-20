import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { Product } from '../src/example/product.model';
import { Category } from '../src/example/category.model';
import { BaseService } from '../src/base/base.service';
import { DEFAULT_CONFIG } from '../src/config/rest-generic.config';
import { getDeniedFieldsForUser, extractUserRoles, stripDeniedFields } from '../src/security/field-access';

class ProductSvc extends BaseService<Product> {}

describe('nest-rest-generic-sequelize · exports + field restriction', () => {
  let sequelize: Sequelize;
  let products: ProductSvc;

  beforeAll(async () => {
    sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false, models: [Product, Category] });
    await sequelize.sync({ force: true });
    products = new ProductSvc(Product, DEFAULT_CONFIG);
    await Product.bulkCreate([
      { name: 'iPhone', price: 999, status: 'active' },
      { name: 'Pixel', price: 799, status: 'active' },
    ] as never);
  });

  afterAll(async () => sequelize.close());

  it('extracts roles from various user shapes', () => {
    expect(extractUserRoles({ roles: ['admin', 'editor'] })).toEqual(['admin', 'editor']);
    expect(extractUserRoles({ roles: [{ name: 'admin' }] })).toEqual(['admin']);
    expect(extractUserRoles({ role: 'viewer' })).toEqual(['viewer']);
  });

  it('computes denied fields from FIELDS_BY_ROLE', () => {
    expect(getDeniedFieldsForUser(Product, { roles: ['admin'] })).toEqual([]);
    expect(getDeniedFieldsForUser(Product, { roles: ['viewer'] })).toEqual(['status']);
    expect(getDeniedFieldsForUser(Product, { is_superuser: true })).toEqual([]);
  });

  it('strips denied fields from a payload', () => {
    const denied = products.getDeniedFields({ roles: ['viewer'] });
    const clean = stripDeniedFields({ name: 'X', status: 'inactive' }, denied);
    expect(clean).toEqual({ name: 'X' });
  });

  it('exports to Excel (xlsx magic bytes)', async () => {
    const file = await products.exportExcel({ select: ['id', 'name', 'price'] });
    expect(file.mimeType).toContain('spreadsheetml');
    expect(file.buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  }, 30000);

  it('exports to PDF (%PDF header)', async () => {
    const file = await products.exportPdf({ select: ['id', 'name', 'price'] });
    expect(file.mimeType).toBe('application/pdf');
    expect(file.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 30000);
});
