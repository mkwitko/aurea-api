-- AlterEnum
-- Bluesky. Aditivo e sem perda, como a migração anterior.
--
-- Ela não conecta por OAuth: o provider pede `handle` e `app_password` e cria a
-- conta no servidor, sem redirect. Isso é fluxo de tela, não de schema — aqui só
-- entra o destino possível.
ALTER TYPE "SocialPlatform" ADD VALUE 'BLUESKY';
