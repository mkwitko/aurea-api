-- Sem dado de produção: os alvos existentes apontam para contas de um provider
-- que sai, e migrá-los produziria publicação para conta inexistente (spec §3).
-- Se isto rodar depois de qualquer publicação real, está errado e precisa ser
-- reescrito.
DELETE FROM "ExternalReference" WHERE "entityType" = 'SOCIAL_POST_TARGET';
DELETE FROM "ActionTarget";
DELETE FROM "Approval";
DELETE FROM "Action";

-- AlterTable
ALTER TABLE "Action" RENAME COLUMN "providerRequestId" TO "providerPostId";
ALTER TABLE "ActionTarget" ADD COLUMN "socialAccountId" TEXT;

-- AlterEnum
-- Postgres não remove valor de enum: o tipo é recriado sem DISCORD e TELEGRAM,
-- que não existem no provider novo. Seguro porque a tabela está vazia depois dos
-- DELETEs acima.
ALTER TABLE "ActionTarget" ALTER COLUMN "platform" TYPE TEXT;
DROP TYPE "SocialPlatform";
CREATE TYPE "SocialPlatform" AS ENUM ('LINKEDIN', 'X', 'FACEBOOK', 'THREADS');
ALTER TABLE "ActionTarget" ALTER COLUMN "platform" TYPE "SocialPlatform" USING "platform"::"SocialPlatform";
