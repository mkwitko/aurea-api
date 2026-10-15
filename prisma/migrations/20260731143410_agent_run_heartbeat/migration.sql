-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "heartbeatAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AgentRun_status_heartbeatAt_idx" ON "AgentRun"("status", "heartbeatAt");
