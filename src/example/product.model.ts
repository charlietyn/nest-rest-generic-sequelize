import {
  Table,
  Column,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { BaseModel } from '../base/base.model';
import { Category } from './category.model';

/**
 * Example concrete model. Note the static convention members inherited from
 * BaseModel: MODEL, RELATIONS (whitelist), CACHE_INVALIDATES.
 */
@Table({ tableName: 'products', timestamps: false })
export class Product extends BaseModel {
  static readonly MODEL = 'product';
  static readonly RELATIONS = ['category'] as const;

  /**
   * Role-based field write restriction. `status` is only writable by admins;
   * any non-admin write to `status` is silently stripped before persistence.
   */
  static readonly FIELDS_BY_ROLE = { admin: ['status'] };

  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id!: number;

  @Column(DataType.STRING)
  name!: string;

  @Column(DataType.DECIMAL(10, 2))
  price!: number;

  @Column({ type: DataType.STRING, defaultValue: 'active' })
  status!: string;

  @ForeignKey(() => Category)
  @Column({ type: DataType.INTEGER, allowNull: true })
  category_id!: number | null;

  @BelongsTo(() => Category, 'category_id')
  category!: Category;
}
