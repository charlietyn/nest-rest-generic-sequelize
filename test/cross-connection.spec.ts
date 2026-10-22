import 'reflect-metadata';
import { Sequelize, Table, Column, DataType } from 'sequelize-typescript';
import { BaseModel } from '../src/base/base.model';
import { BaseService } from '../src/base/base.service';
import { DEFAULT_CONFIG } from '../src/config/rest-generic.config';
import { OneToManyConfig, ResolvedRelationConfig } from '../src/relations/relation-config';

/**
 * Polyglot persistence: the parent (Owner) lives on one Sequelize instance and
 * the related model (Note) on another. The RelationManager must read/write Note
 * through ITS OWN instance and open the transaction THERE, not on the parent's.
 */
@Table({ tableName: 'owners', timestamps: false })
class Owner extends BaseModel {
  static readonly MODEL = 'owner';
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true }) id!: number;
  @Column(DataType.STRING) name!: string;
}

@Table({ tableName: 'notes', timestamps: false })
class Note extends BaseModel {
  static readonly MODEL = 'note';
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true }) id!: number;
  @Column(DataType.INTEGER) owner_id!: number;
  @Column(DataType.STRING) text!: string;
}

const o2m: ResolvedRelationConfig = {
  _type: 'o2m',
  relationship: 'notes',
  relatedModel: Note,
  parentModel: Owner,
  foreignKey: 'owner_id',
  localKey: 'id',
  mutation: { dataKey: ['notes'], deleteRelated: true },
} as OneToManyConfig & { _type: 'o2m' };

const texts = (rows: unknown[]): unknown[] => rows.map((r) => (r as { get: (k: string) => unknown }).get('text'));

describe('nest-rest-generic-sequelize · cross-connection relations', () => {
  let ownersSeq: Sequelize;
  let notesSeq: Sequelize;
  let ownerSvc: BaseService<Owner>;
  let ownerId: number;

  beforeAll(async () => {
    ownersSeq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false, models: [Owner] });
    notesSeq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false, models: [Note] });
    await ownersSeq.sync({ force: true });
    await notesSeq.sync({ force: true });

    ownerSvc = new (class extends BaseService<Owner> {})(Owner, DEFAULT_CONFIG);

    const owner = await Owner.create({ name: 'Ada' } as never);
    ownerId = owner.get('id') as number;
    await Note.bulkCreate([
      { owner_id: ownerId, text: 'first' },
      { owner_id: ownerId, text: 'second' },
    ] as never);
  });

  afterAll(async () => {
    await ownersSeq.close();
    await notesSeq.close();
  });

  it('lists a related model that lives on another connection', async () => {
    const res = (await ownerSvc.listRelation(o2m, ownerId, {})) as { data: unknown[] };
    expect((texts(res.data) as string[]).sort()).toEqual(['first', 'second']);
  });

  it('creates a related model on its own connection (transaction there)', async () => {
    const res = await ownerSvc.createRelation(o2m, ownerId, { text: 'third' }, false);
    expect(res.success).toBe(true);
    expect(await Note.count()).toBe(3);
  });
});
