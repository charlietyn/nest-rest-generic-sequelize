import {
  Table,
  Column,
  DataType,
  ForeignKey,
  BelongsTo,
  HasMany,
} from 'sequelize-typescript';
import { BaseModel } from '../base/base.model';

/**
 * Example self-referencing model demonstrating hierarchical listing:
 * `HIERARCHY_FIELD_ID` points at the adjacency-list parent column.
 */
@Table({ tableName: 'categories', timestamps: false })
export class Category extends BaseModel {
  static readonly MODEL = 'category';
  static readonly RELATIONS = ['parent', 'children'] as const;
  static readonly HIERARCHY_FIELD_ID = 'parent_id';

  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id!: number;

  @Column(DataType.STRING)
  name!: string;

  @ForeignKey(() => Category)
  @Column({ type: DataType.INTEGER, allowNull: true })
  parent_id!: number | null;

  @BelongsTo(() => Category, 'parent_id')
  parent!: Category;

  @HasMany(() => Category, 'parent_id')
  children!: Category[];
}
