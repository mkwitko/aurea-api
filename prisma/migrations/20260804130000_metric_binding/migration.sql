-- CreateTable
CREATE TABLE "MetricBinding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetricBinding_experimentId_key" ON "MetricBinding"("experimentId");

-- CreateIndex
CREATE INDEX "MetricBinding_workspaceId_idx" ON "MetricBinding"("workspaceId");

-- AddForeignKey
ALTER TABLE "MetricBinding" ADD CONSTRAINT "MetricBinding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricBinding" ADD CONSTRAINT "MetricBinding_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
