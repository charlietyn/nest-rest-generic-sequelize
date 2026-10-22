import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import {
  GenericRestModule, REST_GENERIC_CONFIG, RGC_CACHE_STORE,
  RgcCacheService, InMemoryCacheStore, RestGenericConfig, injectParams, Scenario,
} from '../src';

@Controller('scenario')
class ScenarioController {
  @Get()
  read(@Req() req: { query: Record<string, unknown> }, @Scenario('fallback') scenario: string) {
    return { ...req.query, scenario };
  }
}

describe('Nest module consumer integration', () => {
  it('resolves partial configuration and a supplied cache store through DI', async () => {
    const store = new InMemoryCacheStore();
    const module = await Test.createTestingModule({
      imports: [GenericRestModule.forRoot({ config: { cache: { enabled: true } }, cacheStore: store })],
    }).compile();
    try {
      const config = module.get<RestGenericConfig>(REST_GENERIC_CONFIG);
      expect(config.cache.enabled).toBe(true);
      expect(config.cache.ttl).toBe(60);
      expect(config.filtering.strictRelations).toBe(true);
      expect(module.get(RGC_CACHE_STORE)).toBe(store);
      const cache = module.get(RgcCacheService);
      await cache.bumpVersion('product');
      expect(await cache.getVersion('product')).toBe(2);
    } finally { await module.close(); }
  });

  it('injects scenario parameters into Express 5 getter-only query properties', async () => {
    const module = await Test.createTestingModule({ controllers: [ScenarioController] }).compile();
    const app: INestApplication = module.createNestApplication();
    app.use(injectParams({ _scenario: 'bulk_update' }));
    try {
      await app.listen(0, '127.0.0.1');
      const response = await fetch(`${await app.getUrl()}/scenario?existing=value&_scenario=wrong`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ existing: 'value', _scenario: 'bulk_update', scenario: 'bulk_update' });
    } finally { await app.close(); }
  });
});
