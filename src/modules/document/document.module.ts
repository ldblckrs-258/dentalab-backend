import { Module } from '@nestjs/common';
import { StorageModule } from '@modules/storage';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DocumentCategoryController } from './document-category.controller';
import { DocumentCategoryService } from './document-category.service';

@Module({
  imports: [StorageModule],
  controllers: [DocumentController, DocumentCategoryController],
  providers: [DocumentService, DocumentCategoryService],
  exports: [DocumentService],
})
export class DocumentModule {}
