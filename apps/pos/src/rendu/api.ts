/** Contrat expose par le processus principal (voir principal/preload.ts). */
export interface ArticleCaisse {
  id: string;
  reference: string;
  designation: string;
  designationAr: string | null;
  unite: string;
  decimales: number;
  tauxTva: number;
  prixDetailCentimes: number;
  cumpCentimes: number;
  packDeId: string | null;
  packNbUnites: number | null;
  estVrac: boolean;
  venteAutorisee: boolean;
  familleId: string | null;
  stockSvMilli: number;
}

export interface AvantagePromotion {
  promotionId: string;
  libelle: string;
  type: string;
  remiseCentimes: number;
  prixUnitaireCentimes: number | null;
  unitesOffertesMilli: number;
}

export interface ResultatCode {
  article: ArticleCaisse;
  quantiteMilli: number;
  prixUnitaireCentimes: number;
  prixImpose: boolean;
  codeScanne: string;
}

export interface ClientCaisse {
  id: string;
  code: string;
  nom: string;
  categoriePrix: string;
  remisePourcent: number;
  plafondCreditCentimes: number;
  soldeCentimes: number;
  bloque: number;
  carteFidelite: string | null;
  pointsFidelite: number;
}

export interface EtatSync {
  etat: string;
  couleur: 'vert' | 'orange' | 'rouge';
  message: string;
  enAttente: number;
}

export interface UtilisateurCaisse {
  id: string;
  nom: string;
  permissions: string[];
}

interface ApiCaisse {
  connexion(code: string, pin: string): Promise<
    { ok: true; utilisateur: UtilisateurCaisse; plafondRemise: number } | { ok: false; message: string }
  >;
  etatSync(): Promise<EtatSync>;
  synchroniser(): Promise<unknown>;
  sessionCourante(): Promise<{ numero: string; fondDeCaisseCentimes: number } | null>;
  ouvrirSession(fondDeCaisseCentimes: number): Promise<{ numero: string }>;
  previsualiserCloture(comptage: unknown): Promise<{
    theoriqueEspecesCentimes: number;
    compteEspecesCentimes: number;
    ecartEspecesCentimes: number;
    justificationRequise: boolean;
    nombreTickets: number;
  }>;
  cloturer(comptage: unknown, justification: string): Promise<{ ecartCentimes: number }>;
  chercherCode(code: string): Promise<ResultatCode | null>;
  promotionsLigne(
    articleId: string, quantiteMilli: number, prixUnitaireCentimes: number,
  ): Promise<AvantagePromotion[]>;
  promotionsEnCours(): Promise<unknown[]>;
  chercherTexte(texte: string): Promise<ArticleCaisse[]>;
  chercherClient(texte: string): Promise<ClientCaisse[]>;
  controlerCredit(clientId: string, montantCentimes: number): Promise<{
    autorise: boolean; motif: string | null; message: string | null; forcagePossible: boolean;
  }>;
  encaisser(panier: unknown, reglements: unknown): Promise<{
    ticket: { numero: string; totalTtcCentimes: number }; renduCentimes: number;
  }>;
  imprimer(numero: string): Promise<{ texte: string }>;
  ouvrirTiroir(): Promise<unknown>;
  surEtatSync(rappel: (etat: EtatSync) => void): () => void;
}

declare global {
  interface Window { caisse: ApiCaisse }
}

export const caisse = (): ApiCaisse => window.caisse;
