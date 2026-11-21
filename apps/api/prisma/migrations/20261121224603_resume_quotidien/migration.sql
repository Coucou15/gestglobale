-- CreateTable
CREATE TABLE "ResumeQuotidien" (
    "id" TEXT NOT NULL,
    "magasinId" TEXT NOT NULL,
    "jour" TIMESTAMP(3) NOT NULL,
    "donnees" JSONB NOT NULL,
    "texte" TEXT NOT NULL,
    "destinataires" TEXT[],
    "envoyeLe" TIMESTAMP(3),
    "erreurEnvoi" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeQuotidien_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResumeQuotidien_jour_idx" ON "ResumeQuotidien"("jour");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeQuotidien_magasinId_jour_key" ON "ResumeQuotidien"("magasinId", "jour");

-- AddForeignKey
ALTER TABLE "ResumeQuotidien" ADD CONSTRAINT "ResumeQuotidien_magasinId_fkey" FOREIGN KEY ("magasinId") REFERENCES "Magasin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
