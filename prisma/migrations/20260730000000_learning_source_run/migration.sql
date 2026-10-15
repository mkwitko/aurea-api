-- Provenance for learnings drafted by the interpret-outcome agent.
-- Nullable so hand-written learnings keep NULL, and Postgres treats NULLs as
-- distinct in a unique index — any number of manual learnings coexist while a
-- given run can be accepted exactly once.
ALTER TABLE "Learning" ADD COLUMN "sourceAgentRunId" TEXT;
CREATE UNIQUE INDEX "Learning_sourceAgentRunId_key" ON "Learning"("sourceAgentRunId");
