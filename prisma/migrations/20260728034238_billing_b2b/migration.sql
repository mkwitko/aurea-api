-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'STARTER',
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL';

-- O plano sai do workspace e vai para a organização. Copiar antes de dropar:
-- hoje todos são STARTER, mas uma migration não pode assumir isso e sumir com
-- dado. Org com workspaces de planos diferentes (hoje impossível) fica com o
-- maior — max() sobre enum segue a ordem de declaração STARTER < GROWTH < SCALE.
UPDATE "Organization" o
SET "plan" = w.max_plan
FROM (
  SELECT "organizationId", MAX("plan") AS max_plan
  FROM "Workspace"
  WHERE "deletedAt" IS NULL
  GROUP BY "organizationId"
) w
WHERE o."id" = w."organizationId";

-- AlterTable
ALTER TABLE "Workspace" DROP COLUMN "plan";

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripeCustomerId_key" ON "Organization"("stripeCustomerId");
