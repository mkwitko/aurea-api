-- Apaga as Actions existentes antes de mudar o modelo: elas referenciam
-- `payload.channelId` de um provider aposentado (Postiz), e migrá-las produziria
-- alvos apontando para plataformas que ninguém autorizou. Válido porque não há
-- dado de produção — o Postiz nunca foi conectado a uma instância real
-- (spec §4.5). Se isto rodar depois de qualquer publicação real, a migração está
-- errada e precisa ser reescrita.
DELETE FROM "ExternalReference" WHERE "entityType" = 'SOCIAL_POST';
DELETE FROM "Approval";
DELETE FROM "Action";

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('LINKEDIN', 'X', 'FACEBOOK', 'THREADS', 'DISCORD', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "ActionTargetStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'DELIVERY_UNKNOWN');

-- AlterEnum
-- Postgres 12+ aceita ADD VALUE dentro de transação desde que o valor novo não
-- seja *usado* na mesma transação. Nada abaixo o usa.
ALTER TYPE "ActionStatus" ADD VALUE 'PARTIALLY_EXECUTED';

-- AlterTable
ALTER TABLE "Action" DROP COLUMN "attempts",
DROP COLUMN "lastError",
DROP COLUMN "failureKind",
ADD COLUMN "providerRequestId" TEXT;

-- CreateTable
CREATE TABLE "ActionTarget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "status" "ActionTargetStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "postUrl" TEXT,
    "lastError" TEXT,
    "failureKind" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActionTarget_actionId_platform_key" ON "ActionTarget"("actionId", "platform");

-- CreateIndex
CREATE INDEX "ActionTarget_workspaceId_idx" ON "ActionTarget"("workspaceId");

-- CreateIndex
CREATE INDEX "ActionTarget_actionId_idx" ON "ActionTarget"("actionId");

-- AddForeignKey
ALTER TABLE "ActionTarget" ADD CONSTRAINT "ActionTarget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTarget" ADD CONSTRAINT "ActionTarget_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;
