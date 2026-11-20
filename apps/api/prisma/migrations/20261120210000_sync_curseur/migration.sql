-- Synchronisation : rendre la descente sure et indexee.
--
-- Deux defauts corriges ici, l'un et l'autre invisibles a petit volume et
-- reveles par le test de charge sur 30 000 articles.
--
-- 1. Un changement de prix ou de code-barres ne touchait pas la fiche
--    article, donc ne descendait jamais vers les caisses. Deux declencheurs
--    remontent desormais la date de modification de l'article des qu'un de
--    ses prix ou de ses codes bouge. La descente peut alors se contenter
--    d'un curseur sur (modifieLe, id), simple et sur.
--
-- 2. Le parcours par curseur n'etait pas indexe : il faut un index sur le
--    couple exact servant au tri, sinon PostgreSQL trie 30 000 lignes a
--    chaque page.

CREATE INDEX IF NOT EXISTS "Article_sync_idx"     ON "Article"     ("modifieLe", "id");
CREATE INDEX IF NOT EXISTS "Tiers_sync_idx"       ON "Tiers"       ("modifieLe", "id");
CREATE INDEX IF NOT EXISTS "Promotion_sync_idx"   ON "Promotion"   ("modifieLe", "id");
CREATE INDEX IF NOT EXISTS "Utilisateur_sync_idx" ON "Utilisateur" ("modifieLe", "id");

CREATE OR REPLACE FUNCTION gestglobale_touche_article() RETURNS trigger AS $$
DECLARE
  cible text;
BEGIN
  cible := COALESCE(NEW."articleId", OLD."articleId");
  IF cible IS NOT NULL THEN
    UPDATE "Article" SET "modifieLe" = NOW() WHERE "id" = cible;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "prix_touche_article" ON "PrixArticle";
CREATE TRIGGER "prix_touche_article"
  AFTER INSERT OR UPDATE OR DELETE ON "PrixArticle"
  FOR EACH ROW EXECUTE FUNCTION gestglobale_touche_article();

DROP TRIGGER IF EXISTS "code_barre_touche_article" ON "CodeBarre";
CREATE TRIGGER "code_barre_touche_article"
  AFTER INSERT OR UPDATE OR DELETE ON "CodeBarre"
  FOR EACH ROW EXECUTE FUNCTION gestglobale_touche_article();
