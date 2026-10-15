-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "concurrencyKey" TEXT;

-- CreateIndex
CREATE INDEX "AgentRun_workspaceId_concurrencyKey_status_idx" ON "AgentRun"("workspaceId", "concurrencyKey", "status");
