CREATE TYPE "ActionType" AS ENUM ('SOCIAL_POST');

CREATE TYPE "ActionStatus" AS ENUM ('PROPOSED', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'EXECUTED', 'FAILED', 'CANCELLED', 'DELIVERY_UNKNOWN');

CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "experimentId" TEXT,
    "type" "ActionType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "payload" JSONB NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "failureKind" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalReference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalReference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Action_workspaceId_idx" ON "Action"("workspaceId");
CREATE INDEX "Action_experimentId_idx" ON "Action"("experimentId");
CREATE INDEX "Action_workspaceId_status_idx" ON "Action"("workspaceId", "status");

CREATE INDEX "Approval_workspaceId_idx" ON "Approval"("workspaceId");
CREATE INDEX "Approval_actionId_idx" ON "Approval"("actionId");

CREATE UNIQUE INDEX "ExternalReference_integrationId_entityType_externalId_key" ON "ExternalReference"("integrationId", "entityType", "externalId");
CREATE UNIQUE INDEX "ExternalReference_integrationId_entityType_entityId_key" ON "ExternalReference"("integrationId", "entityType", "entityId");
CREATE INDEX "ExternalReference_workspaceId_idx" ON "ExternalReference"("workspaceId");
CREATE INDEX "ExternalReference_entityType_entityId_idx" ON "ExternalReference"("entityType", "entityId");

ALTER TABLE "Action" ADD CONSTRAINT "Action_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Action" ADD CONSTRAINT "Action_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Approval" ADD CONSTRAINT "Approval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalReference" ADD CONSTRAINT "ExternalReference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalReference" ADD CONSTRAINT "ExternalReference_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "WorkspaceIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
