-- DropForeignKey
ALTER TABLE "rag_document_permissions" DROP CONSTRAINT "rag_document_permissions_permission_id_fkey";

-- DropForeignKey
ALTER TABLE "rag_document_permissions" DROP CONSTRAINT "rag_document_permissions_rag_document_id_fkey";

-- AlterTable
ALTER TABLE "document_versions" DROP COLUMN "content",
ADD COLUMN     "file_key" TEXT NOT NULL,
ADD COLUMN     "file_name" TEXT NOT NULL,
ADD COLUMN     "file_size" INTEGER NOT NULL,
ADD COLUMN     "mime_type" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "internal_documents" DROP COLUMN "category",
DROP COLUMN "content",
DROP COLUMN "current_version",
ADD COLUMN     "active_version_id" UUID,
ADD COLUMN     "category_id" UUID;

-- DropTable
DROP TABLE "rag_document_permissions";

-- CreateTable
CREATE TABLE "document_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "document_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_access" (
    "id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_categories_name_key" ON "document_categories"("name");

-- CreateIndex
CREATE INDEX "document_access_source_type_source_id_idx" ON "document_access"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "document_access_permission_id_idx" ON "document_access"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_access_source_type_source_id_permission_id_key" ON "document_access"("source_type", "source_id", "permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");

-- AddForeignKey
ALTER TABLE "internal_documents" ADD CONSTRAINT "internal_documents_active_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_documents" ADD CONSTRAINT "internal_documents_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "document_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_categories" ADD CONSTRAINT "document_categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access" ADD CONSTRAINT "document_access_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
