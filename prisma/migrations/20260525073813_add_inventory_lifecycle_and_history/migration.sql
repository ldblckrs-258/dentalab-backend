-- AlterTable
ALTER TABLE "inventory_items"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: add snapshot + reference_type columns as nullable first to allow backfill
ALTER TABLE "inventory_transactions"
  ADD COLUMN "quantity_before" INTEGER,
  ADD COLUMN "quantity_after" INTEGER,
  ADD COLUMN "reference_type" TEXT;

-- Backfill any pre-existing rows (idempotent on empty table)
UPDATE "inventory_transactions"
  SET "quantity_before" = 0,
      "quantity_after" = "quantity_change"
  WHERE "quantity_before" IS NULL;

-- Enforce NOT NULL after backfill
ALTER TABLE "inventory_transactions"
  ALTER COLUMN "quantity_before" SET NOT NULL,
  ALTER COLUMN "quantity_after" SET NOT NULL;

-- CHECK constraints: non-negative quantities on items
ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_qty_nonneg" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "inventory_items_min_qty_nonneg" CHECK ("min_quantity" >= 0);

-- CHECK constraints: valid transaction type + reference_type + snapshot invariant
ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inv_tx_type_valid"
    CHECK ("type" IN ('purchase', 'return', 'usage', 'adjustment', 'damage')),
  ADD CONSTRAINT "inv_tx_ref_type_valid"
    CHECK ("reference_type" IS NULL OR "reference_type" IN ('appointment', 'patient_procedure')),
  ADD CONSTRAINT "inv_tx_qty_after_eq"
    CHECK ("quantity_after" = "quantity_before" + "quantity_change"),
  ADD CONSTRAINT "inv_tx_qty_after_nonneg" CHECK ("quantity_after" >= 0);

-- CreateIndex
CREATE INDEX "inventory_items_is_active_idx" ON "inventory_items" ("is_active");
CREATE INDEX "inventory_items_category_idx" ON "inventory_items" ("category");
CREATE INDEX "inventory_transactions_item_id_created_at_idx"
  ON "inventory_transactions" ("item_id", "created_at" DESC);
CREATE INDEX "inventory_transactions_performed_by_created_at_idx"
  ON "inventory_transactions" ("performed_by", "created_at" DESC);
CREATE INDEX "inventory_transactions_reference_type_reference_id_idx"
  ON "inventory_transactions" ("reference_type", "reference_id");
