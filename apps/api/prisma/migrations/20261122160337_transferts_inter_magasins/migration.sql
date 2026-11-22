-- CreateEnum
CREATE TYPE "StatutTransfertStock" AS ENUM ('PREPARE', 'EXPEDIE', 'RECU', 'ANNULE');

-- AlterEnum
ALTER TYPE "TypeEmplacement" ADD VALUE 'TRANSIT';

-- AlterEnum
ALTER TYPE "TypeMouvement" ADD VALUE 'TRANSFERT_ECART';

-- CreateTable
CREATE TABLE "TransfertStock" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "numeroReception" TEXT,
    "magasinSourceId" TEXT NOT NULL,
    "magasinDestinationId" TEXT NOT NULL,
    "emplacementSourceId" TEXT NOT NULL,
    "emplacementDestinationId" TEXT NOT NULL,
    "statut" "StatutTransfertStock" NOT NULL DEFAULT 'PREPARE',
    "motif" TEXT,
    "avecEcart" BOOLEAN NOT NULL DEFAULT false,
    "creeParId" TEXT NOT NULL,
    "expedieParId" TEXT,
    "recuParId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expedieLe" TIMESTAMP(3),
    "recuLe" TIMESTAMP(3),
    "commentaireReception" TEXT,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransfertStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneTransfertStock" (
    "id" TEXT NOT NULL,
    "transfertId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "quantiteMilli" INTEGER NOT NULL,
    "quantiteRecueMilli" INTEGER,
    "cumpCentimes" BIGINT NOT NULL DEFAULT 0,
    "motifEcart" TEXT,

    CONSTRAINT "LigneTransfertStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransfertStock_numero_key" ON "TransfertStock"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "TransfertStock_numeroReception_key" ON "TransfertStock"("numeroReception");

-- CreateIndex
CREATE INDEX "TransfertStock_statut_idx" ON "TransfertStock"("statut");

-- CreateIndex
CREATE INDEX "TransfertStock_magasinSourceId_statut_idx" ON "TransfertStock"("magasinSourceId", "statut");

-- CreateIndex
CREATE INDEX "TransfertStock_magasinDestinationId_statut_idx" ON "TransfertStock"("magasinDestinationId", "statut");

-- CreateIndex
CREATE INDEX "LigneTransfertStock_articleId_idx" ON "LigneTransfertStock"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "LigneTransfertStock_transfertId_articleId_key" ON "LigneTransfertStock"("transfertId", "articleId");

-- AddForeignKey
ALTER TABLE "TransfertStock" ADD CONSTRAINT "TransfertStock_magasinSourceId_fkey" FOREIGN KEY ("magasinSourceId") REFERENCES "Magasin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransfertStock" ADD CONSTRAINT "TransfertStock_magasinDestinationId_fkey" FOREIGN KEY ("magasinDestinationId") REFERENCES "Magasin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransfertStock" ADD CONSTRAINT "TransfertStock_emplacementSourceId_fkey" FOREIGN KEY ("emplacementSourceId") REFERENCES "Emplacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransfertStock" ADD CONSTRAINT "TransfertStock_emplacementDestinationId_fkey" FOREIGN KEY ("emplacementDestinationId") REFERENCES "Emplacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransfertStock" ADD CONSTRAINT "TransfertStock_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransfertStock" ADD CONSTRAINT "TransfertStock_expedieParId_fkey" FOREIGN KEY ("expedieParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransfertStock" ADD CONSTRAINT "TransfertStock_recuParId_fkey" FOREIGN KEY ("recuParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneTransfertStock" ADD CONSTRAINT "LigneTransfertStock_transfertId_fkey" FOREIGN KEY ("transfertId") REFERENCES "TransfertStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneTransfertStock" ADD CONSTRAINT "LigneTransfertStock_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
