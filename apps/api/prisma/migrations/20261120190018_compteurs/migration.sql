-- CreateTable
CREATE TABLE "Compteur" (
    "cle" TEXT NOT NULL,
    "valeur" INTEGER NOT NULL DEFAULT 0,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Compteur_pkey" PRIMARY KEY ("cle")
);

-- Unicite reelle des parametres : PostgreSQL traite deux NULL comme
-- distincts, l'index unique du schema ne couvre donc pas les parametres
-- globaux. Ces deux index partiels ferment la faille.
CREATE UNIQUE INDEX "Parametre_cle_global_key"
  ON "Parametre" ("cle") WHERE "magasinId" IS NULL;
CREATE UNIQUE INDEX "Parametre_cle_magasin_key"
  ON "Parametre" ("cle", "magasinId") WHERE "magasinId" IS NOT NULL;
