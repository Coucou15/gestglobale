-- CreateEnum
CREATE TYPE "TypeEmplacement" AS ENUM ('DEPOT', 'SURFACE_VENTE', 'RESERVE');

-- CreateEnum
CREATE TYPE "TypeArticle" AS ENUM ('PRODUIT', 'PACK', 'CARTE_CADEAU', 'SERVICE');

-- CreateEnum
CREATE TYPE "UniteMesure" AS ENUM ('UN', 'KG', 'L', 'M');

-- CreateEnum
CREATE TYPE "TypeCodeBarre" AS ENUM ('EAN13', 'EAN8', 'INTERNE', 'GENERIQUE');

-- CreateEnum
CREATE TYPE "CategoriePrix" AS ENUM ('DETAIL', 'GROS', 'CAT3', 'CAT4', 'CAT5', 'PACK');

-- CreateEnum
CREATE TYPE "TypeMouvement" AS ENUM ('RECEPTION', 'RETOUR_FOURNISSEUR', 'VENTE', 'RETOUR_CLIENT', 'TRANSFERT_SORTIE', 'TRANSFERT_ENTREE', 'CASSE', 'PEREMPTION', 'CONSOMMATION_INTERNE', 'AJUSTEMENT_INVENTAIRE', 'SOLDE_INITIAL');

-- CreateEnum
CREATE TYPE "TypeInventaire" AS ENUM ('TOURNANT', 'COMPLET');

-- CreateEnum
CREATE TYPE "StatutInventaire" AS ENUM ('BROUILLON', 'EN_SAISIE', 'A_VALIDER', 'VALIDE', 'ANNULE');

-- CreateEnum
CREATE TYPE "TypeTiers" AS ENUM ('CLIENT', 'FOURNISSEUR', 'LES_DEUX');

-- CreateEnum
CREATE TYPE "TypeClient" AS ENUM ('PARTICULIER', 'CARTE_FIDELITE', 'PROFESSIONNEL', 'INTERNE');

-- CreateEnum
CREATE TYPE "SensMouvementTiers" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "StatutCommande" AS ENUM ('BROUILLON', 'ENVOYEE', 'PARTIELLE', 'RECUE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "TypeReception" AS ENUM ('RECEPTION', 'RETOUR');

-- CreateEnum
CREATE TYPE "StatutReception" AS ENUM ('BROUILLON', 'VALIDEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "ModeReglementAchat" AS ENUM ('COMPTANT', 'CREDIT');

-- CreateEnum
CREATE TYPE "StatutSession" AS ENUM ('OUVERTE', 'CLOTUREE');

-- CreateEnum
CREATE TYPE "TypeDocumentVente" AS ENUM ('TICKET', 'BON_LIVRAISON', 'FACTURE', 'PROFORMA', 'AVOIR', 'RETOUR');

-- CreateEnum
CREATE TYPE "StatutDocumentVente" AS ENUM ('VALIDE', 'ANNULE');

-- CreateEnum
CREATE TYPE "ModePaiement" AS ENUM ('ESPECES', 'CARTE', 'CHEQUE', 'CREDIT', 'BON_ACHAT', 'VIREMENT');

-- CreateEnum
CREATE TYPE "TypeCompte" AS ENUM ('CAISSE', 'TIROIR', 'COFFRE', 'BANQUE', 'CCP');

-- CreateEnum
CREATE TYPE "SensOperation" AS ENUM ('ENTREE', 'SORTIE');

-- CreateEnum
CREATE TYPE "CategorieOperation" AS ENUM ('VENTE_COMPTANT', 'REGLEMENT_CLIENT', 'PAIEMENT_FOURNISSEUR', 'ACHAT_COMPTANT', 'DEPENSE', 'SALAIRE', 'AVANCE_SALAIRE', 'APPORT_GERANT', 'RETRAIT_GERANT', 'TRANSFERT', 'ECART_CAISSE', 'AUTRE');

-- CreateEnum
CREATE TYPE "StatutTransfert" AS ENUM ('EN_ATTENTE', 'VALIDE', 'REFUSE');

-- CreateEnum
CREATE TYPE "TypeMouvementCaisse" AS ENUM ('ENTREE_TIROIR', 'SORTIE_TIROIR', 'PRELEVEMENT_COFFRE');

-- CreateEnum
CREATE TYPE "CodeRole" AS ENUM ('CAISSIER', 'CHEF_DE_CAISSE', 'MAGASINIER', 'ACHETEUR', 'COMPTABLE', 'GERANT');

-- CreateEnum
CREATE TYPE "TypePromotion" AS ENUM ('PRIX_BARRE', 'X_POUR_Y', 'REMISE_FAMILLE', 'HAPPY_HOUR');

-- CreateEnum
CREATE TYPE "TypeBon" AS ENUM ('CARTE_CADEAU', 'BON_ACHAT');

-- CreateEnum
CREATE TYPE "TypeContrat" AS ENUM ('CDI', 'CDD', 'ESSAI', 'TEMPS_PARTIEL');

-- CreateEnum
CREATE TYPE "TypeAbsence" AS ENUM ('CONGE_ANNUEL', 'MALADIE', 'INJUSTIFIEE', 'AUTORISATION');

-- CreateEnum
CREATE TYPE "StatutAbsence" AS ENUM ('DEMANDEE', 'VALIDEE', 'REFUSEE');

-- CreateEnum
CREATE TYPE "TypeImport" AS ENUM ('BLANC', 'DEFINITIF');

-- CreateEnum
CREATE TYPE "StatutImport" AS ENUM ('EN_COURS', 'TERMINE', 'ECHOUE', 'ANNULE');

-- CreateEnum
CREATE TYPE "GraviteAnomalie" AS ENUM ('INFO', 'AVERTISSEMENT', 'ERREUR');

-- CreateTable
CREATE TABLE "Societe" (
    "id" TEXT NOT NULL,
    "raisonSociale" TEXT NOT NULL,
    "adresse" TEXT,
    "telephone" TEXT,
    "email" TEXT,
    "rc" TEXT,
    "nif" TEXT,
    "nis" TEXT,
    "articleImposition" TEXT,
    "logoUrl" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Societe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Magasin" (
    "id" TEXT NOT NULL,
    "societeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "adresse" TEXT,
    "telephone" TEXT,
    "rc" TEXT,
    "nif" TEXT,
    "nis" TEXT,
    "articleImposition" TEXT,
    "estSiege" BOOLEAN NOT NULL DEFAULT false,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Magasin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Emplacement" (
    "id" TEXT NOT NULL,
    "magasinId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "type" "TypeEmplacement" NOT NULL,
    "parDefautReception" BOOLEAN NOT NULL DEFAULT false,
    "parDefautVente" BOOLEAN NOT NULL DEFAULT false,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Emplacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rayon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "nomAr" TEXT,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rayon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Famille" (
    "id" TEXT NOT NULL,
    "rayonId" TEXT,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "nomAr" TEXT,
    "suiviPeremption" BOOLEAN NOT NULL DEFAULT false,
    "joursAlertePeremption" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Famille_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gamme" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,

    CONSTRAINT "Gamme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Marque" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,

    CONSTRAINT "Marque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "designationAr" TEXT,
    "type" "TypeArticle" NOT NULL DEFAULT 'PRODUIT',
    "unite" "UniteMesure" NOT NULL DEFAULT 'UN',
    "decimales" INTEGER NOT NULL DEFAULT 0,
    "rayonId" TEXT,
    "familleId" TEXT,
    "gammeId" TEXT,
    "marqueId" TEXT,
    "photoUrl" TEXT,
    "tauxTva" INTEGER NOT NULL DEFAULT 0,
    "packDeId" TEXT,
    "packNbUnites" INTEGER,
    "estVrac" BOOLEAN NOT NULL DEFAULT false,
    "cumpCentimes" BIGINT NOT NULL DEFAULT 0,
    "dernierPrixAchatCentimes" BIGINT NOT NULL DEFAULT 0,
    "gestionLot" BOOLEAN NOT NULL DEFAULT false,
    "joursAlertePeremption" INTEGER NOT NULL DEFAULT 0,
    "poidsUnitaireGrammes" INTEGER,
    "venteAutorisee" BOOLEAN NOT NULL DEFAULT true,
    "archive" BOOLEAN NOT NULL DEFAULT false,
    "importeDepuis" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeBarre" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "TypeCodeBarre" NOT NULL DEFAULT 'EAN13',
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeBarre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeVrac" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "typeValeur" TEXT NOT NULL DEFAULT 'POIDS',
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeVrac_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrixArticle" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "magasinId" TEXT,
    "categorie" "CategoriePrix" NOT NULL,
    "prixCentimes" BIGINT NOT NULL,
    "actifDepuis" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrixArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoriquePrix" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "magasinId" TEXT,
    "categorie" "CategoriePrix" NOT NULL,
    "ancienPrixCentimes" BIGINT NOT NULL,
    "nouveauPrixCentimes" BIGINT NOT NULL,
    "motif" TEXT,
    "lotModificationId" TEXT,
    "utilisateurId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoriquePrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stock" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "emplacementId" TEXT NOT NULL,
    "quantiteMilli" INTEGER NOT NULL DEFAULT 0,
    "seuilAlerteMilli" INTEGER NOT NULL DEFAULT 0,
    "capaciteMilli" INTEGER,
    "derniereEntree" TIMESTAMP(3),
    "derniereSortie" TIMESTAMP(3),
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MouvementStock" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "type" "TypeMouvement" NOT NULL,
    "articleId" TEXT NOT NULL,
    "emplacementId" TEXT NOT NULL,
    "quantiteMilli" INTEGER NOT NULL,
    "stockApresMilli" INTEGER NOT NULL,
    "cumpCentimes" BIGINT NOT NULL DEFAULT 0,
    "valeurCentimes" BIGINT NOT NULL DEFAULT 0,
    "lotId" TEXT,
    "documentType" TEXT,
    "documentId" TEXT,
    "documentNumero" TEXT,
    "motif" TEXT,
    "utilisateurId" TEXT NOT NULL,
    "caisseId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MouvementStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "emplacementId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "datePeremption" TIMESTAMP(3),
    "quantiteMilli" INTEGER NOT NULL DEFAULT 0,
    "receptionId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventaire" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "emplacementId" TEXT NOT NULL,
    "type" "TypeInventaire" NOT NULL,
    "statut" "StatutInventaire" NOT NULL DEFAULT 'BROUILLON',
    "libelle" TEXT,
    "perimetre" JSONB,
    "debuteLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clotureLe" TIMESTAMP(3),
    "utilisateurSaisieId" TEXT NOT NULL,
    "utilisateurValidationId" TEXT,
    "ecartValoriseCentimes" BIGINT NOT NULL DEFAULT 0,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inventaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneInventaire" (
    "id" TEXT NOT NULL,
    "inventaireId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "quantiteTheoriqueMilli" INTEGER NOT NULL,
    "quantiteCompteeMilli" INTEGER,
    "ecartMilli" INTEGER NOT NULL DEFAULT 0,
    "cumpCentimes" BIGINT NOT NULL DEFAULT 0,
    "ecartValoriseCentimes" BIGINT NOT NULL DEFAULT 0,
    "sourceSaisie" TEXT,
    "compteeLe" TIMESTAMP(3),

    CONSTRAINT "LigneInventaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tiers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "TypeTiers" NOT NULL,
    "typeClient" "TypeClient",
    "raisonSociale" TEXT NOT NULL,
    "adresse" TEXT,
    "telephone" TEXT,
    "telephone2" TEXT,
    "email" TEXT,
    "rc" TEXT,
    "nif" TEXT,
    "nis" TEXT,
    "articleImposition" TEXT,
    "banque" TEXT,
    "rib" TEXT,
    "categoriePrix" "CategoriePrix" NOT NULL DEFAULT 'DETAIL',
    "remisePourcent" INTEGER NOT NULL DEFAULT 0,
    "modePaiement" TEXT,
    "soldeCentimes" BIGINT NOT NULL DEFAULT 0,
    "soldeOuvertureCentimes" BIGINT NOT NULL DEFAULT 0,
    "plafondCreditCentimes" BIGINT NOT NULL DEFAULT 0,
    "bloque" BOOLEAN NOT NULL DEFAULT false,
    "motifBlocage" TEXT,
    "carteFidelite" TEXT,
    "pointsFidelite" INTEGER NOT NULL DEFAULT 0,
    "magasinInterneId" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "importeDepuis" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MouvementTiers" (
    "id" TEXT NOT NULL,
    "tiersId" TEXT NOT NULL,
    "sens" "SensMouvementTiers" NOT NULL,
    "montantCentimes" BIGINT NOT NULL,
    "soldeApresCentimes" BIGINT NOT NULL,
    "categorie" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "documentType" TEXT,
    "documentId" TEXT,
    "documentNumero" TEXT,
    "utilisateurId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MouvementTiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Echeance" (
    "id" TEXT NOT NULL,
    "tiersId" TEXT NOT NULL,
    "documentNumero" TEXT NOT NULL,
    "montantCentimes" BIGINT NOT NULL,
    "regleCentimes" BIGINT NOT NULL DEFAULT 0,
    "dateEcheance" TIMESTAMP(3) NOT NULL,
    "relanceLe" TIMESTAMP(3),
    "nombreRelances" INTEGER NOT NULL DEFAULT 0,
    "soldee" BOOLEAN NOT NULL DEFAULT false,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Echeance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandeFournisseur" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "fournisseurId" TEXT NOT NULL,
    "magasinId" TEXT NOT NULL,
    "statut" "StatutCommande" NOT NULL DEFAULT 'BROUILLON',
    "dateCommande" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateLivraisonPrevue" TIMESTAMP(3),
    "totalHtCentimes" BIGINT NOT NULL DEFAULT 0,
    "totalTvaCentimes" BIGINT NOT NULL DEFAULT 0,
    "totalTtcCentimes" BIGINT NOT NULL DEFAULT 0,
    "envoyeeLe" TIMESTAMP(3),
    "canalEnvoi" TEXT,
    "observation" TEXT,
    "utilisateurId" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommandeFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneCommande" (
    "id" TEXT NOT NULL,
    "commandeId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "quantiteMilli" INTEGER NOT NULL,
    "quantiteRecueMilli" INTEGER NOT NULL DEFAULT 0,
    "prixAchatCentimes" BIGINT NOT NULL,
    "remisePourcent" INTEGER NOT NULL DEFAULT 0,
    "tauxTva" INTEGER NOT NULL DEFAULT 0,
    "totalHtCentimes" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "LigneCommande_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reception" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "type" "TypeReception" NOT NULL DEFAULT 'RECEPTION',
    "statut" "StatutReception" NOT NULL DEFAULT 'BROUILLON',
    "fournisseurId" TEXT NOT NULL,
    "magasinId" TEXT NOT NULL,
    "emplacementId" TEXT NOT NULL,
    "commandeId" TEXT,
    "numeroBonFournisseur" TEXT,
    "dateReception" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalHtCentimes" BIGINT NOT NULL DEFAULT 0,
    "totalTvaCentimes" BIGINT NOT NULL DEFAULT 0,
    "totalTtcCentimes" BIGINT NOT NULL DEFAULT 0,
    "observation" TEXT,
    "utilisateurId" TEXT NOT NULL,
    "valideeLe" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneReception" (
    "id" TEXT NOT NULL,
    "receptionId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "quantiteMilli" INTEGER NOT NULL,
    "prixAchatCentimes" BIGINT NOT NULL,
    "remisePourcent" INTEGER NOT NULL DEFAULT 0,
    "tauxTva" INTEGER NOT NULL DEFAULT 0,
    "totalHtCentimes" BIGINT NOT NULL DEFAULT 0,
    "cumpAvantCentimes" BIGINT NOT NULL DEFAULT 0,
    "cumpApresCentimes" BIGINT NOT NULL DEFAULT 0,
    "prixVenteProposeCentimes" BIGINT,
    "prixVenteAppliqueCentimes" BIGINT,
    "lotNumero" TEXT,
    "datePeremption" TIMESTAMP(3),

    CONSTRAINT "LigneReception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureAchat" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "numeroFournisseur" TEXT,
    "fournisseurId" TEXT NOT NULL,
    "receptionId" TEXT,
    "dateFacture" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateEcheance" TIMESTAMP(3),
    "modeReglement" "ModeReglementAchat" NOT NULL DEFAULT 'CREDIT',
    "totalHtCentimes" BIGINT NOT NULL DEFAULT 0,
    "totalTvaCentimes" BIGINT NOT NULL DEFAULT 0,
    "timbreCentimes" BIGINT NOT NULL DEFAULT 0,
    "totalTtcCentimes" BIGINT NOT NULL DEFAULT 0,
    "regleCentimes" BIGINT NOT NULL DEFAULT 0,
    "utilisateurId" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureAchat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Caisse" (
    "id" TEXT NOT NULL,
    "magasinId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "libelle" TEXT NOT NULL,
    "identifiantPoste" TEXT,
    "compteurDocument" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Caisse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionCaisse" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "caisseId" TEXT NOT NULL,
    "statut" "StatutSession" NOT NULL DEFAULT 'OUVERTE',
    "ouverteLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clotureeLe" TIMESTAMP(3),
    "fondDeCaisseCentimes" BIGINT NOT NULL DEFAULT 0,
    "utilisateurOuvertureId" TEXT NOT NULL,
    "utilisateurClotureId" TEXT,
    "horsLigne" BOOLEAN NOT NULL DEFAULT false,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionCaisse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClotureZ" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "theoriqueEspecesCentimes" BIGINT NOT NULL,
    "compteEspecesCentimes" BIGINT NOT NULL,
    "ecartCentimes" BIGINT NOT NULL,
    "justification" TEXT,
    "comptage" JSONB NOT NULL,
    "totauxParMode" JSONB NOT NULL,
    "nombreTickets" INTEGER NOT NULL DEFAULT 0,
    "nombreAnnulations" INTEGER NOT NULL DEFAULT 0,
    "totalRemisesCentimes" BIGINT NOT NULL DEFAULT 0,
    "horsLigne" BOOLEAN NOT NULL DEFAULT false,
    "valideParId" TEXT,
    "valideeLe" TIMESTAMP(3),
    "clotureeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClotureZ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVente" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "type" "TypeDocumentVente" NOT NULL DEFAULT 'TICKET',
    "statut" "StatutDocumentVente" NOT NULL DEFAULT 'VALIDE',
    "magasinId" TEXT NOT NULL,
    "caisseId" TEXT,
    "sessionId" TEXT,
    "clientId" TEXT,
    "utilisateurId" TEXT NOT NULL,
    "dateVente" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalBrutCentimes" BIGINT NOT NULL DEFAULT 0,
    "remisePiedCentimes" BIGINT NOT NULL DEFAULT 0,
    "totalRemiseCentimes" BIGINT NOT NULL DEFAULT 0,
    "totalHtCentimes" BIGINT NOT NULL DEFAULT 0,
    "totalTvaCentimes" BIGINT NOT NULL DEFAULT 0,
    "timbreCentimes" BIGINT NOT NULL DEFAULT 0,
    "totalTtcCentimes" BIGINT NOT NULL DEFAULT 0,
    "renduCentimes" BIGINT NOT NULL DEFAULT 0,
    "margeCentimes" BIGINT NOT NULL DEFAULT 0,
    "horsLigne" BOOLEAN NOT NULL DEFAULT false,
    "prixPerime" BOOLEAN NOT NULL DEFAULT false,
    "documentOrigineId" TEXT,
    "forcageSuperviseurId" TEXT,
    "motifAnnulation" TEXT,
    "recuLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentVente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneVente" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "numeroLigne" INTEGER NOT NULL,
    "articleId" TEXT NOT NULL,
    "codeScanne" TEXT,
    "designation" TEXT NOT NULL,
    "quantiteMilli" INTEGER NOT NULL,
    "prixUnitaireCentimes" BIGINT NOT NULL,
    "remisePourcent" INTEGER NOT NULL DEFAULT 0,
    "remiseCentimes" BIGINT NOT NULL DEFAULT 0,
    "tauxTva" INTEGER NOT NULL DEFAULT 0,
    "totalHtCentimes" BIGINT NOT NULL DEFAULT 0,
    "totalTvaCentimes" BIGINT NOT NULL DEFAULT 0,
    "totalTtcCentimes" BIGINT NOT NULL DEFAULT 0,
    "cumpCentimes" BIGINT NOT NULL DEFAULT 0,
    "margeCentimes" BIGINT NOT NULL DEFAULT 0,
    "annulee" BOOLEAN NOT NULL DEFAULT false,
    "autoriseeParId" TEXT,
    "promotionId" TEXT,
    "unitesStockMilli" INTEGER,

    CONSTRAINT "LigneVente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reglement" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "mode" "ModePaiement" NOT NULL,
    "montantCentimes" BIGINT NOT NULL,
    "reference" TEXT,
    "compteId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reglement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompteTresorerie" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "type" "TypeCompte" NOT NULL,
    "magasinId" TEXT,
    "caisseId" TEXT,
    "soldeCentimes" BIGINT NOT NULL DEFAULT 0,
    "numeroCompte" TEXT,
    "banque" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompteTresorerie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationTresorerie" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "sens" "SensOperation" NOT NULL,
    "categorie" "CategorieOperation" NOT NULL,
    "montantCentimes" BIGINT NOT NULL,
    "soldeApresCentimes" BIGINT NOT NULL,
    "libelle" TEXT NOT NULL,
    "tiersId" TEXT,
    "employeId" TEXT,
    "documentType" TEXT,
    "documentNumero" TEXT,
    "transfertId" TEXT,
    "pointee" BOOLEAN NOT NULL DEFAULT false,
    "dateRapprochement" TIMESTAMP(3),
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "utilisateurId" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationTresorerie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransfertTresorerie" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "compteSourceId" TEXT NOT NULL,
    "compteDestinationId" TEXT NOT NULL,
    "montantCentimes" BIGINT NOT NULL,
    "statut" "StatutTransfert" NOT NULL DEFAULT 'EN_ATTENTE',
    "motif" TEXT,
    "demandeParId" TEXT NOT NULL,
    "valideParId" TEXT,
    "demandeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valideLe" TIMESTAMP(3),
    "commentaireRefus" TEXT,

    CONSTRAINT "TransfertTresorerie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MouvementCaisse" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "TypeMouvementCaisse" NOT NULL,
    "montantCentimes" BIGINT NOT NULL,
    "motif" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "utilisateurId" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MouvementCaisse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Utilisateur" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "email" TEXT,
    "motDePasseHash" TEXT,
    "pinHash" TEXT,
    "role" "CodeRole" NOT NULL,
    "permissionsAjoutees" JSONB NOT NULL DEFAULT '[]',
    "permissionsRetirees" JSONB NOT NULL DEFAULT '[]',
    "doubleAuthActive" BOOLEAN NOT NULL DEFAULT false,
    "secretTotp" TEXT,
    "plagesHoraires" JSONB,
    "postesAutorises" JSONB NOT NULL DEFAULT '[]',
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "derniereConnexion" TIMESTAMP(3),
    "tentativesEchouees" INTEGER NOT NULL DEFAULT 0,
    "bloqueJusqua" TIMESTAMP(3),
    "employeId" TEXT,
    "importeDepuis" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Utilisateur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtilisateurMagasin" (
    "utilisateurId" TEXT NOT NULL,
    "magasinId" TEXT NOT NULL,

    CONSTRAINT "UtilisateurMagasin_pkey" PRIMARY KEY ("utilisateurId","magasinId")
);

-- CreateTable
CREATE TABLE "JetonRafraichissement" (
    "id" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "empreinte" TEXT NOT NULL,
    "expireLe" TIMESTAMP(3) NOT NULL,
    "revoqueLe" TIMESTAMP(3),
    "adresseIp" TEXT,
    "agent" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JetonRafraichissement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalAudit" (
    "id" TEXT NOT NULL,
    "numero" BIGSERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "utilisateurId" TEXT,
    "action" TEXT NOT NULL,
    "entite" TEXT,
    "entiteId" TEXT,
    "magasinId" TEXT,
    "caisseId" TEXT,
    "poste" TEXT,
    "adresseIp" TEXT,
    "details" JSONB,
    "empreintePrecedente" TEXT,
    "empreinte" TEXT NOT NULL,

    CONSTRAINT "JournalAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "type" "TypePromotion" NOT NULL,
    "debut" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "articleId" TEXT,
    "familleId" TEXT,
    "valeurCentimes" BIGINT,
    "remisePourcent" INTEGER,
    "quantiteDeclenchement" INTEGER,
    "quantiteOfferte" INTEGER,
    "heureDebut" TEXT,
    "heureFin" TEXT,
    "cumulable" BOOLEAN NOT NULL DEFAULT false,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonAchat" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "TypeBon" NOT NULL,
    "montantCentimes" BIGINT NOT NULL,
    "soldeCentimes" BIGINT NOT NULL,
    "emisLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expireLe" TIMESTAMP(3),
    "clientId" TEXT,
    "utilise" BOOLEAN NOT NULL DEFAULT false,
    "documentEmissionNumero" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BonAchat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employe" (
    "id" TEXT NOT NULL,
    "matricule" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "nin" TEXT,
    "numeroSecuriteSociale" TEXT,
    "dateNaissance" TIMESTAMP(3),
    "adresse" TEXT,
    "telephone" TEXT,
    "situationFamiliale" TEXT,
    "nombreEnfants" INTEGER NOT NULL DEFAULT 0,
    "poste" TEXT,
    "magasinId" TEXT,
    "dateEmbauche" TIMESTAMP(3),
    "dateSortie" TIMESTAMP(3),
    "photoUrl" TEXT,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "soldeCongesJours" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contrat" (
    "id" TEXT NOT NULL,
    "employeId" TEXT NOT NULL,
    "type" "TypeContrat" NOT NULL,
    "debut" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3),
    "salaireBaseCentimes" BIGINT NOT NULL,
    "primesFixes" JSONB NOT NULL DEFAULT '[]',
    "alerteEnvoyeeLe" TIMESTAMP(3),
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contrat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pointage" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "employeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "entree" TIMESTAMP(3),
    "sortie" TIMESTAMP(3),
    "minutesTravaillees" INTEGER NOT NULL DEFAULT 0,
    "minutesRetard" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "horsLigne" BOOLEAN NOT NULL DEFAULT false,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pointage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Planning" (
    "id" TEXT NOT NULL,
    "magasinId" TEXT NOT NULL,
    "employeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "heureDebut" TEXT NOT NULL,
    "heureFin" TEXT NOT NULL,
    "poste" TEXT,
    "echangeAvecEmployeId" TEXT,
    "valideParId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Planning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "employeId" TEXT NOT NULL,
    "type" "TypeAbsence" NOT NULL,
    "statut" "StatutAbsence" NOT NULL DEFAULT 'DEMANDEE',
    "debut" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "nombreJours" INTEGER NOT NULL,
    "motif" TEXT,
    "justificatifUrl" TEXT,
    "valideParId" TEXT,
    "valideeLe" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvanceSalaire" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "employeId" TEXT NOT NULL,
    "montantCentimes" BIGINT NOT NULL,
    "rembourseCentimes" BIGINT NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "motif" TEXT,
    "bulletinId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvanceSalaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulletinPaie" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "employeId" TEXT NOT NULL,
    "periodeAnnee" INTEGER NOT NULL,
    "periodeMois" INTEGER NOT NULL,
    "salaireBaseCentimes" BIGINT NOT NULL DEFAULT 0,
    "heuresSupplementaires" INTEGER NOT NULL DEFAULT 0,
    "heuresSupCentimes" BIGINT NOT NULL DEFAULT 0,
    "primesCentimes" BIGINT NOT NULL DEFAULT 0,
    "retenues" JSONB NOT NULL DEFAULT '[]',
    "retenuesCentimes" BIGINT NOT NULL DEFAULT 0,
    "brutCentimes" BIGINT NOT NULL DEFAULT 0,
    "cotisationsCentimes" BIGINT NOT NULL DEFAULT 0,
    "irgCentimes" BIGINT NOT NULL DEFAULT 0,
    "netAPayerCentimes" BIGINT NOT NULL DEFAULT 0,
    "tauxAppliques" JSONB,
    "payeLe" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulletinPaie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurseurSync" (
    "id" TEXT NOT NULL,
    "caisseId" TEXT NOT NULL,
    "curseur" TEXT,
    "derniereDescenteLe" TIMESTAMP(3),
    "derniereRemonteeLe" TIMESTAMP(3),
    "versionProtocole" INTEGER NOT NULL DEFAULT 1,
    "versionCaisse" TEXT,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurseurSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tombstone" (
    "id" TEXT NOT NULL,
    "entite" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tombstone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionImport" (
    "id" TEXT NOT NULL,
    "nomFichier" TEXT NOT NULL,
    "type" "TypeImport" NOT NULL,
    "statut" "StatutImport" NOT NULL DEFAULT 'EN_COURS',
    "rapport" JSONB NOT NULL DEFAULT '{}',
    "controles" JSONB,
    "debuteLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "termineLe" TIMESTAMP(3),
    "utilisateurId" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnomalieImport" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "onglet" TEXT NOT NULL,
    "ligne" INTEGER,
    "champ" TEXT,
    "valeur" TEXT,
    "gravite" "GraviteAnomalie" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnomalieImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parametre" (
    "id" TEXT NOT NULL,
    "cle" TEXT NOT NULL,
    "magasinId" TEXT,
    "valeur" JSONB NOT NULL,
    "description" TEXT,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Parametre_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Magasin_code_key" ON "Magasin"("code");

-- CreateIndex
CREATE INDEX "Magasin_societeId_idx" ON "Magasin"("societeId");

-- CreateIndex
CREATE INDEX "Emplacement_magasinId_idx" ON "Emplacement"("magasinId");

-- CreateIndex
CREATE UNIQUE INDEX "Emplacement_magasinId_code_key" ON "Emplacement"("magasinId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Rayon_code_key" ON "Rayon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Famille_code_key" ON "Famille"("code");

-- CreateIndex
CREATE INDEX "Famille_rayonId_idx" ON "Famille"("rayonId");

-- CreateIndex
CREATE UNIQUE INDEX "Gamme_code_key" ON "Gamme"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Marque_code_key" ON "Marque"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Article_reference_key" ON "Article"("reference");

-- CreateIndex
CREATE INDEX "Article_familleId_idx" ON "Article"("familleId");

-- CreateIndex
CREATE INDEX "Article_rayonId_idx" ON "Article"("rayonId");

-- CreateIndex
CREATE INDEX "Article_archive_venteAutorisee_idx" ON "Article"("archive", "venteAutorisee");

-- CreateIndex
CREATE INDEX "Article_designation_idx" ON "Article"("designation");

-- CreateIndex
CREATE UNIQUE INDEX "CodeBarre_code_key" ON "CodeBarre"("code");

-- CreateIndex
CREATE INDEX "CodeBarre_articleId_idx" ON "CodeBarre"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "CodeVrac_code_key" ON "CodeVrac"("code");

-- CreateIndex
CREATE INDEX "CodeVrac_articleId_idx" ON "CodeVrac"("articleId");

-- CreateIndex
CREATE INDEX "PrixArticle_articleId_idx" ON "PrixArticle"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "PrixArticle_articleId_magasinId_categorie_key" ON "PrixArticle"("articleId", "magasinId", "categorie");

-- CreateIndex
CREATE INDEX "HistoriquePrix_articleId_date_idx" ON "HistoriquePrix"("articleId", "date");

-- CreateIndex
CREATE INDEX "HistoriquePrix_date_idx" ON "HistoriquePrix"("date");

-- CreateIndex
CREATE INDEX "Stock_emplacementId_idx" ON "Stock"("emplacementId");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_articleId_emplacementId_key" ON "Stock"("articleId", "emplacementId");

-- CreateIndex
CREATE UNIQUE INDEX "MouvementStock_numero_key" ON "MouvementStock"("numero");

-- CreateIndex
CREATE INDEX "MouvementStock_articleId_date_idx" ON "MouvementStock"("articleId", "date");

-- CreateIndex
CREATE INDEX "MouvementStock_emplacementId_date_idx" ON "MouvementStock"("emplacementId", "date");

-- CreateIndex
CREATE INDEX "MouvementStock_date_idx" ON "MouvementStock"("date");

-- CreateIndex
CREATE INDEX "MouvementStock_documentNumero_idx" ON "MouvementStock"("documentNumero");

-- CreateIndex
CREATE INDEX "Lot_datePeremption_idx" ON "Lot"("datePeremption");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_articleId_emplacementId_numero_key" ON "Lot"("articleId", "emplacementId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "Inventaire_numero_key" ON "Inventaire"("numero");

-- CreateIndex
CREATE INDEX "Inventaire_emplacementId_statut_idx" ON "Inventaire"("emplacementId", "statut");

-- CreateIndex
CREATE INDEX "LigneInventaire_inventaireId_idx" ON "LigneInventaire"("inventaireId");

-- CreateIndex
CREATE UNIQUE INDEX "LigneInventaire_inventaireId_articleId_key" ON "LigneInventaire"("inventaireId", "articleId");

-- CreateIndex
CREATE UNIQUE INDEX "Tiers_code_key" ON "Tiers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Tiers_carteFidelite_key" ON "Tiers"("carteFidelite");

-- CreateIndex
CREATE INDEX "Tiers_type_actif_idx" ON "Tiers"("type", "actif");

-- CreateIndex
CREATE INDEX "Tiers_raisonSociale_idx" ON "Tiers"("raisonSociale");

-- CreateIndex
CREATE INDEX "MouvementTiers_tiersId_date_idx" ON "MouvementTiers"("tiersId", "date");

-- CreateIndex
CREATE INDEX "MouvementTiers_documentNumero_idx" ON "MouvementTiers"("documentNumero");

-- CreateIndex
CREATE INDEX "Echeance_tiersId_soldee_idx" ON "Echeance"("tiersId", "soldee");

-- CreateIndex
CREATE INDEX "Echeance_dateEcheance_soldee_idx" ON "Echeance"("dateEcheance", "soldee");

-- CreateIndex
CREATE UNIQUE INDEX "CommandeFournisseur_numero_key" ON "CommandeFournisseur"("numero");

-- CreateIndex
CREATE INDEX "CommandeFournisseur_fournisseurId_statut_idx" ON "CommandeFournisseur"("fournisseurId", "statut");

-- CreateIndex
CREATE INDEX "LigneCommande_commandeId_idx" ON "LigneCommande"("commandeId");

-- CreateIndex
CREATE UNIQUE INDEX "Reception_numero_key" ON "Reception"("numero");

-- CreateIndex
CREATE INDEX "Reception_fournisseurId_dateReception_idx" ON "Reception"("fournisseurId", "dateReception");

-- CreateIndex
CREATE INDEX "Reception_statut_idx" ON "Reception"("statut");

-- CreateIndex
CREATE INDEX "LigneReception_receptionId_idx" ON "LigneReception"("receptionId");

-- CreateIndex
CREATE UNIQUE INDEX "FactureAchat_numero_key" ON "FactureAchat"("numero");

-- CreateIndex
CREATE INDEX "FactureAchat_fournisseurId_dateFacture_idx" ON "FactureAchat"("fournisseurId", "dateFacture");

-- CreateIndex
CREATE UNIQUE INDEX "Caisse_identifiantPoste_key" ON "Caisse"("identifiantPoste");

-- CreateIndex
CREATE UNIQUE INDEX "Caisse_magasinId_numero_key" ON "Caisse"("magasinId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "SessionCaisse_numero_key" ON "SessionCaisse"("numero");

-- CreateIndex
CREATE INDEX "SessionCaisse_caisseId_statut_idx" ON "SessionCaisse"("caisseId", "statut");

-- CreateIndex
CREATE UNIQUE INDEX "ClotureZ_numero_key" ON "ClotureZ"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "ClotureZ_sessionId_key" ON "ClotureZ"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVente_numero_key" ON "DocumentVente"("numero");

-- CreateIndex
CREATE INDEX "DocumentVente_magasinId_dateVente_idx" ON "DocumentVente"("magasinId", "dateVente");

-- CreateIndex
CREATE INDEX "DocumentVente_dateVente_idx" ON "DocumentVente"("dateVente");

-- CreateIndex
CREATE INDEX "DocumentVente_clientId_dateVente_idx" ON "DocumentVente"("clientId", "dateVente");

-- CreateIndex
CREATE INDEX "DocumentVente_sessionId_idx" ON "DocumentVente"("sessionId");

-- CreateIndex
CREATE INDEX "DocumentVente_utilisateurId_dateVente_idx" ON "DocumentVente"("utilisateurId", "dateVente");

-- CreateIndex
CREATE INDEX "LigneVente_documentId_idx" ON "LigneVente"("documentId");

-- CreateIndex
CREATE INDEX "LigneVente_articleId_idx" ON "LigneVente"("articleId");

-- CreateIndex
CREATE INDEX "Reglement_documentId_idx" ON "Reglement"("documentId");

-- CreateIndex
CREATE INDEX "Reglement_mode_idx" ON "Reglement"("mode");

-- CreateIndex
CREATE UNIQUE INDEX "CompteTresorerie_code_key" ON "CompteTresorerie"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CompteTresorerie_caisseId_key" ON "CompteTresorerie"("caisseId");

-- CreateIndex
CREATE INDEX "CompteTresorerie_magasinId_idx" ON "CompteTresorerie"("magasinId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationTresorerie_numero_key" ON "OperationTresorerie"("numero");

-- CreateIndex
CREATE INDEX "OperationTresorerie_compteId_date_idx" ON "OperationTresorerie"("compteId", "date");

-- CreateIndex
CREATE INDEX "OperationTresorerie_categorie_date_idx" ON "OperationTresorerie"("categorie", "date");

-- CreateIndex
CREATE INDEX "OperationTresorerie_date_idx" ON "OperationTresorerie"("date");

-- CreateIndex
CREATE UNIQUE INDEX "TransfertTresorerie_numero_key" ON "TransfertTresorerie"("numero");

-- CreateIndex
CREATE INDEX "TransfertTresorerie_statut_idx" ON "TransfertTresorerie"("statut");

-- CreateIndex
CREATE UNIQUE INDEX "MouvementCaisse_reference_key" ON "MouvementCaisse"("reference");

-- CreateIndex
CREATE INDEX "MouvementCaisse_sessionId_idx" ON "MouvementCaisse"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Utilisateur_code_key" ON "Utilisateur"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Utilisateur_login_key" ON "Utilisateur"("login");

-- CreateIndex
CREATE UNIQUE INDEX "Utilisateur_employeId_key" ON "Utilisateur"("employeId");

-- CreateIndex
CREATE INDEX "Utilisateur_role_actif_idx" ON "Utilisateur"("role", "actif");

-- CreateIndex
CREATE UNIQUE INDEX "JetonRafraichissement_empreinte_key" ON "JetonRafraichissement"("empreinte");

-- CreateIndex
CREATE INDEX "JetonRafraichissement_utilisateurId_idx" ON "JetonRafraichissement"("utilisateurId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalAudit_numero_key" ON "JournalAudit"("numero");

-- CreateIndex
CREATE INDEX "JournalAudit_date_idx" ON "JournalAudit"("date");

-- CreateIndex
CREATE INDEX "JournalAudit_utilisateurId_date_idx" ON "JournalAudit"("utilisateurId", "date");

-- CreateIndex
CREATE INDEX "JournalAudit_entite_entiteId_idx" ON "JournalAudit"("entite", "entiteId");

-- CreateIndex
CREATE INDEX "JournalAudit_action_date_idx" ON "JournalAudit"("action", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion"("code");

-- CreateIndex
CREATE INDEX "Promotion_actif_debut_fin_idx" ON "Promotion"("actif", "debut", "fin");

-- CreateIndex
CREATE UNIQUE INDEX "BonAchat_code_key" ON "BonAchat"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Employe_matricule_key" ON "Employe"("matricule");

-- CreateIndex
CREATE INDEX "Employe_magasinId_actif_idx" ON "Employe"("magasinId", "actif");

-- CreateIndex
CREATE INDEX "Contrat_employeId_actif_idx" ON "Contrat"("employeId", "actif");

-- CreateIndex
CREATE INDEX "Contrat_fin_idx" ON "Contrat"("fin");

-- CreateIndex
CREATE UNIQUE INDEX "Pointage_reference_key" ON "Pointage"("reference");

-- CreateIndex
CREATE INDEX "Pointage_date_idx" ON "Pointage"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Pointage_employeId_date_key" ON "Pointage"("employeId", "date");

-- CreateIndex
CREATE INDEX "Planning_magasinId_date_idx" ON "Planning"("magasinId", "date");

-- CreateIndex
CREATE INDEX "Planning_employeId_date_idx" ON "Planning"("employeId", "date");

-- CreateIndex
CREATE INDEX "Absence_employeId_debut_idx" ON "Absence"("employeId", "debut");

-- CreateIndex
CREATE UNIQUE INDEX "AvanceSalaire_numero_key" ON "AvanceSalaire"("numero");

-- CreateIndex
CREATE INDEX "AvanceSalaire_employeId_idx" ON "AvanceSalaire"("employeId");

-- CreateIndex
CREATE UNIQUE INDEX "BulletinPaie_numero_key" ON "BulletinPaie"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "BulletinPaie_employeId_periodeAnnee_periodeMois_key" ON "BulletinPaie"("employeId", "periodeAnnee", "periodeMois");

-- CreateIndex
CREATE UNIQUE INDEX "CurseurSync_caisseId_key" ON "CurseurSync"("caisseId");

-- CreateIndex
CREATE INDEX "Tombstone_date_idx" ON "Tombstone"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Tombstone_entite_entiteId_key" ON "Tombstone"("entite", "entiteId");

-- CreateIndex
CREATE INDEX "AnomalieImport_sessionId_gravite_idx" ON "AnomalieImport"("sessionId", "gravite");

-- CreateIndex
CREATE UNIQUE INDEX "Parametre_cle_magasinId_key" ON "Parametre"("cle", "magasinId");

-- AddForeignKey
ALTER TABLE "Magasin" ADD CONSTRAINT "Magasin_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Emplacement" ADD CONSTRAINT "Emplacement_magasinId_fkey" FOREIGN KEY ("magasinId") REFERENCES "Magasin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Famille" ADD CONSTRAINT "Famille_rayonId_fkey" FOREIGN KEY ("rayonId") REFERENCES "Rayon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_rayonId_fkey" FOREIGN KEY ("rayonId") REFERENCES "Rayon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_familleId_fkey" FOREIGN KEY ("familleId") REFERENCES "Famille"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_gammeId_fkey" FOREIGN KEY ("gammeId") REFERENCES "Gamme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_marqueId_fkey" FOREIGN KEY ("marqueId") REFERENCES "Marque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_packDeId_fkey" FOREIGN KEY ("packDeId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeBarre" ADD CONSTRAINT "CodeBarre_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeVrac" ADD CONSTRAINT "CodeVrac_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrixArticle" ADD CONSTRAINT "PrixArticle_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrixArticle" ADD CONSTRAINT "PrixArticle_magasinId_fkey" FOREIGN KEY ("magasinId") REFERENCES "Magasin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoriquePrix" ADD CONSTRAINT "HistoriquePrix_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoriquePrix" ADD CONSTRAINT "HistoriquePrix_magasinId_fkey" FOREIGN KEY ("magasinId") REFERENCES "Magasin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoriquePrix" ADD CONSTRAINT "HistoriquePrix_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_emplacementId_fkey" FOREIGN KEY ("emplacementId") REFERENCES "Emplacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_emplacementId_fkey" FOREIGN KEY ("emplacementId") REFERENCES "Emplacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_caisseId_fkey" FOREIGN KEY ("caisseId") REFERENCES "Caisse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_emplacementId_fkey" FOREIGN KEY ("emplacementId") REFERENCES "Emplacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventaire" ADD CONSTRAINT "Inventaire_emplacementId_fkey" FOREIGN KEY ("emplacementId") REFERENCES "Emplacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventaire" ADD CONSTRAINT "Inventaire_utilisateurSaisieId_fkey" FOREIGN KEY ("utilisateurSaisieId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventaire" ADD CONSTRAINT "Inventaire_utilisateurValidationId_fkey" FOREIGN KEY ("utilisateurValidationId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_inventaireId_fkey" FOREIGN KEY ("inventaireId") REFERENCES "Inventaire"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tiers" ADD CONSTRAINT "Tiers_magasinInterneId_fkey" FOREIGN KEY ("magasinInterneId") REFERENCES "Magasin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementTiers" ADD CONSTRAINT "MouvementTiers_tiersId_fkey" FOREIGN KEY ("tiersId") REFERENCES "Tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementTiers" ADD CONSTRAINT "MouvementTiers_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Echeance" ADD CONSTRAINT "Echeance_tiersId_fkey" FOREIGN KEY ("tiersId") REFERENCES "Tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandeFournisseur" ADD CONSTRAINT "CommandeFournisseur_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandeFournisseur" ADD CONSTRAINT "CommandeFournisseur_magasinId_fkey" FOREIGN KEY ("magasinId") REFERENCES "Magasin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandeFournisseur" ADD CONSTRAINT "CommandeFournisseur_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneCommande" ADD CONSTRAINT "LigneCommande_commandeId_fkey" FOREIGN KEY ("commandeId") REFERENCES "CommandeFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneCommande" ADD CONSTRAINT "LigneCommande_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reception" ADD CONSTRAINT "Reception_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reception" ADD CONSTRAINT "Reception_magasinId_fkey" FOREIGN KEY ("magasinId") REFERENCES "Magasin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reception" ADD CONSTRAINT "Reception_emplacementId_fkey" FOREIGN KEY ("emplacementId") REFERENCES "Emplacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reception" ADD CONSTRAINT "Reception_commandeId_fkey" FOREIGN KEY ("commandeId") REFERENCES "CommandeFournisseur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reception" ADD CONSTRAINT "Reception_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneReception" ADD CONSTRAINT "LigneReception_receptionId_fkey" FOREIGN KEY ("receptionId") REFERENCES "Reception"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneReception" ADD CONSTRAINT "LigneReception_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureAchat" ADD CONSTRAINT "FactureAchat_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureAchat" ADD CONSTRAINT "FactureAchat_receptionId_fkey" FOREIGN KEY ("receptionId") REFERENCES "Reception"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureAchat" ADD CONSTRAINT "FactureAchat_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caisse" ADD CONSTRAINT "Caisse_magasinId_fkey" FOREIGN KEY ("magasinId") REFERENCES "Magasin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_caisseId_fkey" FOREIGN KEY ("caisseId") REFERENCES "Caisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_utilisateurOuvertureId_fkey" FOREIGN KEY ("utilisateurOuvertureId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_utilisateurClotureId_fkey" FOREIGN KEY ("utilisateurClotureId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClotureZ" ADD CONSTRAINT "ClotureZ_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SessionCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClotureZ" ADD CONSTRAINT "ClotureZ_valideParId_fkey" FOREIGN KEY ("valideParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVente" ADD CONSTRAINT "DocumentVente_magasinId_fkey" FOREIGN KEY ("magasinId") REFERENCES "Magasin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVente" ADD CONSTRAINT "DocumentVente_caisseId_fkey" FOREIGN KEY ("caisseId") REFERENCES "Caisse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVente" ADD CONSTRAINT "DocumentVente_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SessionCaisse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVente" ADD CONSTRAINT "DocumentVente_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVente" ADD CONSTRAINT "DocumentVente_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVente" ADD CONSTRAINT "DocumentVente_forcageSuperviseurId_fkey" FOREIGN KEY ("forcageSuperviseurId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVente" ADD CONSTRAINT "DocumentVente_documentOrigineId_fkey" FOREIGN KEY ("documentOrigineId") REFERENCES "DocumentVente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentVente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_autoriseeParId_fkey" FOREIGN KEY ("autoriseeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reglement" ADD CONSTRAINT "Reglement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentVente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reglement" ADD CONSTRAINT "Reglement_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "CompteTresorerie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompteTresorerie" ADD CONSTRAINT "CompteTresorerie_magasinId_fkey" FOREIGN KEY ("magasinId") REFERENCES "Magasin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompteTresorerie" ADD CONSTRAINT "CompteTresorerie_caisseId_fkey" FOREIGN KEY ("caisseId") REFERENCES "Caisse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationTresorerie" ADD CONSTRAINT "OperationTresorerie_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "CompteTresorerie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationTresorerie" ADD CONSTRAINT "OperationTresorerie_tiersId_fkey" FOREIGN KEY ("tiersId") REFERENCES "Tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationTresorerie" ADD CONSTRAINT "OperationTresorerie_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "Employe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationTresorerie" ADD CONSTRAINT "OperationTresorerie_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationTresorerie" ADD CONSTRAINT "OperationTresorerie_transfertId_fkey" FOREIGN KEY ("transfertId") REFERENCES "TransfertTresorerie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransfertTresorerie" ADD CONSTRAINT "TransfertTresorerie_compteSourceId_fkey" FOREIGN KEY ("compteSourceId") REFERENCES "CompteTresorerie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransfertTresorerie" ADD CONSTRAINT "TransfertTresorerie_compteDestinationId_fkey" FOREIGN KEY ("compteDestinationId") REFERENCES "CompteTresorerie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransfertTresorerie" ADD CONSTRAINT "TransfertTresorerie_demandeParId_fkey" FOREIGN KEY ("demandeParId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransfertTresorerie" ADD CONSTRAINT "TransfertTresorerie_valideParId_fkey" FOREIGN KEY ("valideParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementCaisse" ADD CONSTRAINT "MouvementCaisse_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SessionCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementCaisse" ADD CONSTRAINT "MouvementCaisse_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Utilisateur" ADD CONSTRAINT "Utilisateur_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "Employe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilisateurMagasin" ADD CONSTRAINT "UtilisateurMagasin_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilisateurMagasin" ADD CONSTRAINT "UtilisateurMagasin_magasinId_fkey" FOREIGN KEY ("magasinId") REFERENCES "Magasin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JetonRafraichissement" ADD CONSTRAINT "JetonRafraichissement_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalAudit" ADD CONSTRAINT "JournalAudit_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_familleId_fkey" FOREIGN KEY ("familleId") REFERENCES "Famille"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employe" ADD CONSTRAINT "Employe_magasinId_fkey" FOREIGN KEY ("magasinId") REFERENCES "Magasin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contrat" ADD CONSTRAINT "Contrat_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "Employe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pointage" ADD CONSTRAINT "Pointage_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "Employe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planning" ADD CONSTRAINT "Planning_magasinId_fkey" FOREIGN KEY ("magasinId") REFERENCES "Magasin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planning" ADD CONSTRAINT "Planning_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "Employe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "Employe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvanceSalaire" ADD CONSTRAINT "AvanceSalaire_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "Employe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvanceSalaire" ADD CONSTRAINT "AvanceSalaire_bulletinId_fkey" FOREIGN KEY ("bulletinId") REFERENCES "BulletinPaie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulletinPaie" ADD CONSTRAINT "BulletinPaie_employeId_fkey" FOREIGN KEY ("employeId") REFERENCES "Employe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurseurSync" ADD CONSTRAINT "CurseurSync_caisseId_fkey" FOREIGN KEY ("caisseId") REFERENCES "Caisse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionImport" ADD CONSTRAINT "SessionImport_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnomalieImport" ADD CONSTRAINT "AnomalieImport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SessionImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Parametre" ADD CONSTRAINT "Parametre_magasinId_fkey" FOREIGN KEY ("magasinId") REFERENCES "Magasin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
