-- AlterTable
ALTER TABLE "DocumentVente" ADD COLUMN     "brouillon" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dateEcheance" TIMESTAMP(3),
ADD COLUMN     "documentSourceId" TEXT,
ADD COLUMN     "mentions" JSONB,
ADD COLUMN     "observation" TEXT,
ADD COLUMN     "valideLe" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "DocumentVente" ADD CONSTRAINT "DocumentVente_documentSourceId_fkey" FOREIGN KEY ("documentSourceId") REFERENCES "DocumentVente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
