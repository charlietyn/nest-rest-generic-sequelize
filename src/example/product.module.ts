import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Product } from './product.model';
import { Category } from './category.model';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';

/**
 * Wiring example. Register the models and the generic service/controller.
 * Remember to import `GenericRestModule.forRoot({...})` once at the app root.
 */
@Module({
  imports: [SequelizeModule.forFeature([Product, Category])],
  providers: [ProductService],
  controllers: [ProductController],
  exports: [ProductService],
})
export class ProductModule {}
