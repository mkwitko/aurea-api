-- Aditiva: coluna nula em toda linha existente, nenhum backfill.
ALTER TABLE "Experiment" ADD COLUMN "sourceAgentRunId" TEXT;

CREATE UNIQUE INDEX "Experiment_sourceAgentRunId_key" ON "Experiment"("sourceAgentRunId");
