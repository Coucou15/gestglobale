-- CreateEnum
CREATE TYPE "OrigineHistorique" AS ENUM ('VENTE', 'RECEPTION', 'MOUVEMENT_STOCK', 'TRESORERIE', 'CLOTURE_CAISSE');

-- CreateTable
CREATE TABLE "LigneHistorique" (
    "id" TEXT NOT NULL,
    "origine" "OrigineHistorique" NOT NULL,
    "sessionImportId" TEXT,
    "ongletSource" TEXT NOT NULL,
    "ligneSource" INTEGER,
    "date" TIMESTAMP(3),
    "heure" TEXT,
    "type" TEXT,
    "numeroDocument" TEXT,
    "reference" TEXT,
    "libelle" TEXT,
    "tiersCode" TEXT,
    "tiersNom" TEXT,
    "utilisateur" TEXT,
    "caisse" TEXT,
    "magasin" TEXT,
    "modeReglement" TEXT,
    "quantiteMilli" INTEGER,
    "montantHtCentimes" BIGINT,
    "montantTvaCentimes" BIGINT,
    "montantTimbreCentimes" BIGINT,
    "montantTtcCentimes" BIGINT,
    "margeCentimes" BIGINT,
    "donnees" JSONB NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LigneHistorique_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LigneHistorique_origine_date_idx" ON "LigneHistorique"("origine", "date");

-- CreateIndex
CREATE INDEX "LigneHistorique_numeroDocument_idx" ON "LigneHistorique"("numeroDocument");

-- CreateIndex
CREATE INDEX "LigneHistorique_reference_idx" ON "LigneHistorique"("reference");

-- CreateIndex
CREATE INDEX "LigneHistorique_tiersCode_idx" ON "LigneHistorique"("tiersCode");

-- AddForeignKey
ALTER TABLE "LigneHistorique" ADD CONSTRAINT "LigneHistorique_sessionImportId_fkey" FOREIGN KEY ("sessionImportId") REFERENCES "SessionImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
