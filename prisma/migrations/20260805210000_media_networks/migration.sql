-- AlterEnum
-- Aditivo e sem perda: Instagram, TikTok e YouTube passam a ser destinos válidos
-- de ActionTarget. Nenhuma linha existente muda, e nenhum valor é removido —
-- Postgres não remove valor de enum sem recriar o tipo, e recriar exigiria a
-- tabela vazia (foi o que a migração anterior fez, por outro motivo).
--
-- `ADD VALUE` dentro de transação é permitido no Postgres 12+ desde que o valor
-- novo não seja usado na mesma transação. Não é: quem os usa é a aplicação.
ALTER TYPE "SocialPlatform" ADD VALUE 'INSTAGRAM';
ALTER TYPE "SocialPlatform" ADD VALUE 'TIKTOK';
ALTER TYPE "SocialPlatform" ADD VALUE 'YOUTUBE';
