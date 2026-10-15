-- AlterTable
ALTER TABLE "Outcome" ADD COLUMN     "periodStart" TIMESTAMP(3),
ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "sourceDetail" JSONB;
