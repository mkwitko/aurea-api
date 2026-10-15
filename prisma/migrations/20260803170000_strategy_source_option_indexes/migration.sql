-- Uma adoção pode fundir duas ou três opções da mesma proposta num único plano.
-- `sourceOptionIndex` guarda a opção primária (a de menor índice), que é o que a
-- unicidade existente protege; esta coluna guarda o conjunto inteiro, para que a
-- proveniência não minta sobre o que o fundador combinou.
ALTER TABLE "Strategy" ADD COLUMN "sourceOptionIndexes" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- As estratégias já adotadas vieram de uma opção só.
UPDATE "Strategy"
SET "sourceOptionIndexes" = ARRAY["sourceOptionIndex"]
WHERE "sourceOptionIndex" IS NOT NULL;
