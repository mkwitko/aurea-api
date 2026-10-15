-- Workspaces que o registro criou com o nome 'Default' e que ninguém nunca
-- usou. O registro deixou de criá-los; estas contas entram no mesmo fluxo de
-- "crie seu primeiro workspace" no próximo login.
--
-- O crédito de trial some junto no cascade — e volta, no mesmo valor, quando a
-- conta criar o primeiro workspace (createWorkspaceForOrg). Os critérios abaixo
-- só casam com quem nunca gastou um crédito, então o saldo é preservado.
CREATE TEMPORARY TABLE untouched_default AS
SELECT w."id"
FROM "Workspace" w
WHERE w."slug" = 'default'
  -- Único workspace da organização. Uma org com dois já escolheu algum nome.
  AND (SELECT count(*) FROM "Workspace" w2 WHERE w2."organizationId" = w."organizationId") = 1
  AND NOT EXISTS (SELECT 1 FROM "Business" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Icp" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Goal" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Strategy" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Hypothesis" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Experiment" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Outcome" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Learning" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "AgentRun" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "WorkspaceProviderKey" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "CreditPeriod" t WHERE t."workspaceId" = w."id")
  -- Exatamente o lançamento do trial, e nada mais: qualquer débito, compra ou
  -- franquia significa que a conta usou este workspace.
  AND (SELECT count(*) FROM "CreditLedger" l WHERE l."workspaceId" = w."id") = 1
  AND EXISTS (
    SELECT 1 FROM "CreditLedger" l
    WHERE l."workspaceId" = w."id" AND l."kind" = 'GRANT' AND l."reason" = 'trial credits'
  )
-- Tranca as linhas candidatas entre o snapshot e o DELETE: sem isto, uma
-- escrita (Business, Icp, AgentRun, ...) que aterrisse num destes workspaces
-- durante uma migração em rolling deploy não aparece no snapshot mas ainda
-- assim é apagada em cascata com ele. Inserir uma linha filha tranca a
-- Workspace referenciada em FOR KEY SHARE, que conflita com FOR UPDATE — o
-- lock serializa o escritor concorrente em vez de só encolher a janela.
-- Legal aqui: a consulta externa não tem GROUP BY/DISTINCT/UNION.
FOR UPDATE;

-- Ordem obrigatória. Membership."workspaceId" tem ON DELETE CASCADE, então
-- apagar o workspace primeiro apagaria a única membership do usuário — ele
-- ficaria sem papel nenhum em /auth/me e a tela de criar workspace tomaria 403
-- ao submeter. Soltar a membership do workspace a transforma na membership de
-- organização que o registro passou a criar.
UPDATE "Membership"
SET "workspaceId" = NULL
WHERE "workspaceId" IN (SELECT "id" FROM untouched_default);

DELETE FROM "Workspace" WHERE "id" IN (SELECT "id" FROM untouched_default);

DROP TABLE untouched_default;
