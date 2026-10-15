-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "cachedInputTokens" INTEGER,
ADD COLUMN     "input" JSONB,
ADD COLUMN     "inputHash" TEXT,
ADD COLUMN     "modelCalls" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "output" JSONB,
ADD COLUMN     "queuedAt" TIMESTAMP(3),
ADD COLUMN     "requestedBy" TEXT,
ADD COLUMN     "tier" TEXT;

-- CreateTable
CREATE TABLE "AgentToolCall" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "result" JSONB,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "durationMs" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentToolCall_agentRunId_idx" ON "AgentToolCall"("agentRunId");

-- CreateIndex
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_workspaceId_taskType_inputHash_idx" ON "AgentRun"("workspaceId", "taskType", "inputHash");

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
