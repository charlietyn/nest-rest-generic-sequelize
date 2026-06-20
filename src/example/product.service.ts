import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BaseService } from '../base/base.service';
import { Product } from './product.model';
import { DEFAULT_CONFIG, REST_GENERIC_CONFIG, RestGenericConfig } from '../config/rest-generic.config';
import { RgcCacheService } from '../cache/cache.service';

/**
 * Concrete service — inject the model and forward to `super`.
 * Override the protected `cacheable*` fields to tune caching per model.
 */
@Injectable()
export class ProductService extends BaseService<Product> {
  protected cacheableOperations = ['list_all', 'get_one'];

  constructor(
    @InjectModel(Product) model: typeof Product,
    @Optional() @Inject(REST_GENERIC_CONFIG) config?: RestGenericConfig,
    @Optional() cache?: RgcCacheService,
  ) {
    super(model, config ?? DEFAULT_CONFIG, cache);
  }
}
