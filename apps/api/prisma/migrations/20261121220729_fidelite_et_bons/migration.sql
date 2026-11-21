-- AlterTable
ALTER TABLE "BonAchat" ADD COLUMN     "actif" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emisParId" TEXT,
ADD COLUMN     "motifAnnulation" TEXT;

-- CreateTable
CREATE TABLE "UtilisationBon" (
    "id" TEXT NOT NULL,
    "bonId" TEXT NOT NULL,
    "documentNumero" TEXT NOT NULL,
    "montantCentimes" BIGINT NOT NULL,
    "soldeApresCentimes" BIGINT NOT NULL,
    "horsLigne" BOOLEAN NOT NULL DEFAULT false,
    "decouvertCentimes" BIGINT NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "utilisateurId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UtilisationBon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MouvementFidelite" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "soldeApres" INTEGER NOT NULL,
    "motif" TEXT NOT NULL,
    "documentNumero" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MouvementFidelite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UtilisationBon_date_idx" ON "UtilisationBon"("date");

-- CreateIndex
CREATE INDEX "UtilisationBon_decouvertCentimes_idx" ON "UtilisationBon"("decouvertCentimes");

-- CreateIndex
CREATE UNIQUE INDEX "UtilisationBon_bonId_documentNumero_key" ON "UtilisationBon"("bonId", "documentNumero");

-- CreateIndex
CREATE INDEX "MouvementFidelite_clientId_date_idx" ON "MouvementFidelite"("clientId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MouvementFidelite_clientId_documentNumero_motif_key" ON "MouvementFidelite"("clientId", "documentNumero", "motif");

-- CreateIndex
CREATE INDEX "BonAchat_actif_utilise_idx" ON "BonAchat"("actif", "utilise");

-- CreateIndex
CREATE INDEX "BonAchat_clientId_idx" ON "BonAchat"("clientId");

-- AddForeignKey
ALTER TABLE "BonAchat" ADD CONSTRAINT "BonAchat_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilisationBon" ADD CONSTRAINT "UtilisationBon_bonId_fkey" FOREIGN KEY ("bonId") REFERENCES "BonAchat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementFidelite" ADD CONSTRAINT "MouvementFidelite_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Tiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
