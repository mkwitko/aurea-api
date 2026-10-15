-- AlterTable
ALTER TABLE "Strategy" ADD COLUMN     "sourceAgentRunId" TEXT,
ADD COLUMN     "sourceOptionIndex" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Strategy_sourceAgentRunId_sourceOptionIndex_key" ON "Strategy"("sourceAgentRunId", "sourceOptionIndex");
