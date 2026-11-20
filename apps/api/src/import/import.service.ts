import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GraviteAnomalie, Prisma, StatutImport, TypeImport, TypeTiers, TypeClient, CategoriePrix, UniteMesure } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { b } from '../commun/bigint';
import { normaliserUnite, ean13Valide } from '@gestglobale/shared';
import { lireTampon, champ, nombre, type OngletLu, type LigneBrute } from './lecture';

export interface Anomalie {
  onglet: string;
  ligne: number | null;
  champ: string | null;
  valeur: string | null;
  gravite: GraviteAnomalie;
  code: string;
  message: string;
}

export interface RapportOnglet {
  lus: number;
  retenus: number;
  ignores: number;
  erreurs: number;
}

export interface ResultatAnalyse {
  onglets: Record<string, RapportOnglet>;
  anomalies: Anomalie[];
  controles: {
    nombreArticles: number;
    valeurStockCumpCentimes: number;
    totalSoldesClientsCentimes: number;
    totalSoldesFournisseursCentimes: number;
    nombreCodesBarres: number;
    nombrePacks: number;
    nombreVracs: number;
    articlesStockNul: number;
    articlesStockNegatif: number;
  };
}

/** Correspondance entre un onglet du classeur et son traitement. */
const ALIAS_ONGLETS: Record<string, string> = {
  produits: 'PRODUITS',
  produit: 'PRODUITS',
  articles: 'PRODUITS',
  generiques: 'GENERIQUES',
  generique: 'GENERIQUES',
  packs: 'PACKS',
  pack: 'PACKS',
  vracs: 'VRACS',
  vrac: 'VRACS',
  clients: 'CLIENTS',
  client: 'CLIENTS',
  fournisseurs: 'FOURNISSEURS',
  fournisseur: 'FOURNISSEURS',
};

function cleOnglet(nom: string): string | null {
  const n = nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return ALIAS_ONGLETS[n] ?? null;
}

interface ArticlePrepare {
  reference: string;
  designation: string;
  unite: UniteMesure;
  decimales: number;
  cumpCentimes: number;
  dernierPrixAchatCentimes: number;
  prixDetailCentimes: number;
  prixGrosCentimes: number | null;
  prixPackCentimes: number | null;
  tauxTva: number;
  stockDepotMilli: number;
  stockVenteMilli: number;
  seuilAlerteMilli: number;
  rayon: string;
  famille: string;
  codeBarrePrincipal: string | null;
  ligne: number;
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Analyse le classeur sans rien ecrire : c'est l'« import a blanc » du
   * deroule de la section 7. Il produit le rapport d'erreurs et de doublons
   * que le gerant corrige avant la bascule.
   */
  async analyser(tampon: Buffer): Promise<{ onglets: OngletLu[]; resultat: ResultatAnalyse }> {
    const { resultat } = await this.preparer(tampon);
    return { onglets: [], resultat };
  }

  /** Lit et prepare tout le classeur, sans rien ecrire. */
  private async preparer(tampon: Buffer): Promise<{
    resultat: ResultatAnalyse;
    donnees: {
      articles: ArticlePrepare[];
      codesBarres: Array<{ code: string; reference: string }>;
      packs: Array<{ code: string; reference: string; nbUnites: number; prixCentimes: number }>;
      vracs: Array<{ code: string; reference: string; nom: string }>;
      clients: ReturnType<ImportService['preparerTiers']>;
      fournisseurs: ReturnType<ImportService['preparerTiers']>;
    };
  }> {
    const onglets = await lireTampon(tampon);
    const anomalies: Anomalie[] = [];
    const rapport: Record<string, RapportOnglet> = {};

    const parCle = new Map<string, OngletLu>();
    for (const onglet of onglets) {
      const cle = cleOnglet(onglet.nom);
      rapport[onglet.nom] = {
        lus: onglet.lignes.length,
        retenus: 0,
        ignores: onglet.lignesIgnorees,
        erreurs: 0,
      };
      if (cle && !parCle.has(cle)) parCle.set(cle, onglet);
    }

    for (const attendu of ['PRODUITS', 'CLIENTS', 'FOURNISSEURS']) {
      if (!parCle.has(attendu)) {
        anomalies.push({
          onglet: attendu, ligne: null, champ: null, valeur: null,
          gravite: GraviteAnomalie.ERREUR,
          code: 'ONGLET_ABSENT',
          message: `L'onglet ${attendu} est absent du classeur`,
        });
      }
    }

    const articles = this.preparerArticles(parCle.get('PRODUITS'), anomalies, rapport);
    const codesBarres = this.preparerCodesBarres(
      parCle.get('GENERIQUES'), articles, anomalies, rapport,
    );
    const packs = this.preparerPacks(parCle.get('PACKS'), articles, anomalies, rapport);
    const vracs = this.preparerVracs(parCle.get('VRACS'), articles, anomalies, rapport);
    const clients = this.preparerTiers(
      parCle.get('CLIENTS'), TypeTiers.CLIENT, anomalies, rapport,
    );
    const fournisseurs = this.preparerTiers(
      parCle.get('FOURNISSEURS'), TypeTiers.FOURNISSEUR, anomalies, rapport,
    );

    const valeurStock = articles.reduce(
      (t, a) => t + Math.round(((a.stockDepotMilli + a.stockVenteMilli) * a.cumpCentimes) / 1000),
      0,
    );

    return {
      donnees: { articles, codesBarres, packs, vracs, clients, fournisseurs },
      resultat: {
        onglets: rapport,
        anomalies,
        controles: {
          nombreArticles: articles.length,
          valeurStockCumpCentimes: valeurStock,
          totalSoldesClientsCentimes: clients.reduce((t, x) => t + x.soldeCentimes, 0),
          totalSoldesFournisseursCentimes: fournisseurs.reduce((t, x) => t + x.soldeCentimes, 0),
          nombreCodesBarres: codesBarres.length + articles.filter((a) => a.codeBarrePrincipal).length,
          nombrePacks: packs.length,
          nombreVracs: vracs.length,
          articlesStockNul: articles.filter(
            (a) => a.stockDepotMilli === 0 && a.stockVenteMilli === 0,
          ).length,
          articlesStockNegatif: articles.filter(
            (a) => a.stockDepotMilli < 0 || a.stockVenteMilli < 0,
          ).length,
        },
      },
    };
  }

  private preparerArticles(
    onglet: OngletLu | undefined,
    anomalies: Anomalie[],
    rapport: Record<string, RapportOnglet>,
  ): ArticlePrepare[] {
    if (!onglet) return [];
    const resultats: ArticlePrepare[] = [];
    const referencesVues = new Map<string, number>();
    const codesVus = new Map<string, number>();

    for (const ligne of onglet.lignes) {
      const reference = champ(ligne, 'REFERENCE', 'REF', 'CODE PRODUIT', 'CODE');
      const designation = champ(ligne, 'DESIGNATION', 'LIBELLE', 'NOM');

      if (!reference) {
        anomalies.push(this.anomalie(onglet.nom, ligne, 'REFERENCE', '', 'REFERENCE_MANQUANTE',
          'Ligne sans reference : elle ne peut pas etre importee'));
        rapport[onglet.nom].erreurs++;
        continue;
      }
      if (!designation) {
        anomalies.push(this.anomalie(onglet.nom, ligne, 'DESIGNATION', '', 'DESIGNATION_MANQUANTE',
          `Article ${reference} sans designation`, GraviteAnomalie.AVERTISSEMENT));
      }

      const premiere = referencesVues.get(reference);
      if (premiere !== undefined) {
        anomalies.push(this.anomalie(onglet.nom, ligne, 'REFERENCE', reference,
          'REFERENCE_DOUBLON',
          `Reference deja vue ligne ${premiere} : la seconde occurrence est ignoree`));
        rapport[onglet.nom].erreurs++;
        continue;
      }
      referencesVues.set(reference, ligne.numero);

      // Unites : U -> UN, K -> KG, GR -> KG. Les valeurs aberrantes de
      // l'export (« . », « + », « 28272 ») sont listees pour correction.
      const uniteBrute = champ(ligne, 'UNITE', 'UNITE DE MESURE', 'UM');
      const { unite, facteur, suspecte } = normaliserUnite(uniteBrute);
      if (suspecte && uniteBrute) {
        anomalies.push(this.anomalie(onglet.nom, ligne, 'UNITE', uniteBrute, 'UNITE_ABERRANTE',
          `Unite « ${uniteBrute} » non reconnue : UN a ete retenu, a verifier`,
          GraviteAnomalie.AVERTISSEMENT));
      }

      const stockMc = (nombre(champ(ligne, 'STOCK ACTUEL (MC)', 'STOCK MC', 'STOCK DEPOT')) ?? 0) * facteur;
      const stockSv = (nombre(champ(ligne, 'STOCK ACTUEL (SV)', 'STOCK SV', 'STOCK VENTE')) ?? 0) * facteur;

      if (stockMc < 0 || stockSv < 0) {
        anomalies.push(this.anomalie(onglet.nom, ligne, 'STOCK', `${stockMc} / ${stockSv}`,
          'STOCK_NEGATIF',
          `Stock negatif : a corriger par un inventaire avant la bascule`,
          GraviteAnomalie.AVERTISSEMENT));
      }

      // Les seuils negatifs de l'export sont remis a 0 (section 7).
      const seuilBrut = nombre(champ(ligne, 'SEUIL', 'SEUIL ALERTE', 'STOCK MINI')) ?? 0;
      if (seuilBrut < 0) {
        anomalies.push(this.anomalie(onglet.nom, ligne, 'SEUIL', String(seuilBrut),
          'SEUIL_NEGATIF', 'Seuil d’alerte negatif remis a 0', GraviteAnomalie.INFO));
      }

      const codeBarre = champ(ligne, 'CODE BARRE', 'CODE A BARRE', 'EAN', 'GENCOD');
      if (codeBarre) {
        const deja = codesVus.get(codeBarre);
        if (deja !== undefined) {
          anomalies.push(this.anomalie(onglet.nom, ligne, 'CODE BARRE', codeBarre,
            'CODE_BARRE_DOUBLON',
            `Code-barres deja porte par la ligne ${deja} : il ne sera pas repris ici`));
          rapport[onglet.nom].erreurs++;
        } else {
          codesVus.set(codeBarre, ligne.numero);
          if (/^\d{13}$/.test(codeBarre) && !ean13Valide(codeBarre)) {
            anomalies.push(this.anomalie(onglet.nom, ligne, 'CODE BARRE', codeBarre,
              'EAN_CLE_INVALIDE', 'Cle de controle EAN-13 incorrecte',
              GraviteAnomalie.AVERTISSEMENT));
          }
        }
      }

      const prixDetail = Math.round((nombre(champ(ligne, 'PRIX DETAIL', 'PRIX VENTE', 'PV')) ?? 0) * 100);
      const cump = Math.round((nombre(champ(ligne, 'CUMP', 'PRIX MOYEN', 'PMP')) ?? 0) * 100);

      if (prixDetail > 0 && cump > 0 && prixDetail < cump) {
        anomalies.push(this.anomalie(onglet.nom, ligne, 'PRIX DETAIL', String(prixDetail / 100),
          'VENTE_A_PERTE',
          `Prix de vente (${prixDetail / 100}) sous le cout d’achat (${cump / 100})`,
          GraviteAnomalie.AVERTISSEMENT));
      }

      resultats.push({
        reference,
        designation: designation || reference,
        unite,
        decimales: unite === 'UN' ? 0 : 3,
        cumpCentimes: cump,
        dernierPrixAchatCentimes: Math.round(
          (nombre(champ(ligne, 'DERNIER PRIX ACHAT', 'PRIX ACHAT', 'PA')) ?? 0) * 100,
        ),
        prixDetailCentimes: prixDetail,
        prixGrosCentimes: this.prixOuNull(champ(ligne, 'PRIX GROS', 'PRIX DEMI GROS')),
        prixPackCentimes: this.prixOuNull(champ(ligne, 'PRIX PACK')),
        tauxTva: Math.round(nombre(champ(ligne, 'TVA', 'TAUX TVA')) ?? 0),
        stockDepotMilli: Math.round(stockMc * 1000),
        stockVenteMilli: Math.round(stockSv * 1000),
        seuilAlerteMilli: Math.max(0, Math.round(seuilBrut * 1000)),
        rayon: champ(ligne, 'RAYON'),
        famille: champ(ligne, 'FAMILLE'),
        codeBarrePrincipal: codeBarre && !codesVus.has(`${codeBarre}#pris`) ? codeBarre : null,
        ligne: ligne.numero,
      });
      rapport[onglet.nom].retenus++;
    }

    return resultats;
  }

  private prixOuNull(valeur: string): number | null {
    const n = nombre(valeur);
    return n === null || n <= 0 ? null : Math.round(n * 100);
  }

  private preparerCodesBarres(
    onglet: OngletLu | undefined,
    articles: ArticlePrepare[],
    anomalies: Anomalie[],
    rapport: Record<string, RapportOnglet>,
  ): Array<{ code: string; reference: string }> {
    if (!onglet) return [];
    const references = new Set(articles.map((a) => a.reference));
    const vus = new Set(articles.map((a) => a.codeBarrePrincipal).filter(Boolean) as string[]);
    const resultats: Array<{ code: string; reference: string }> = [];

    for (const ligne of onglet.lignes) {
      const code = champ(ligne, 'CODE GENERIQUE', 'CODE', 'CODE BARRE');
      const reference = champ(ligne, 'PRODUIT', 'REFERENCE', 'CODE PRODUIT');

      if (!code || !reference) {
        rapport[onglet.nom].erreurs++;
        anomalies.push(this.anomalie(onglet.nom, ligne, 'CODE GENERIQUE', code,
          'LIGNE_INCOMPLETE', 'Code ou produit manquant'));
        continue;
      }
      if (!references.has(reference)) {
        rapport[onglet.nom].erreurs++;
        anomalies.push(this.anomalie(onglet.nom, ligne, 'PRODUIT', reference,
          'PRODUIT_INCONNU', `Le produit ${reference} n’existe pas dans l’onglet PRODUITS`));
        continue;
      }
      if (vus.has(code)) {
        rapport[onglet.nom].erreurs++;
        anomalies.push(this.anomalie(onglet.nom, ligne, 'CODE GENERIQUE', code,
          'CODE_BARRE_DOUBLON',
          'Ce code est deja attribue : un code ne peut appartenir qu’a un article'));
        continue;
      }
      vus.add(code);
      resultats.push({ code, reference });
      rapport[onglet.nom].retenus++;
    }
    return resultats;
  }

  private preparerPacks(
    onglet: OngletLu | undefined,
    articles: ArticlePrepare[],
    anomalies: Anomalie[],
    rapport: Record<string, RapportOnglet>,
  ): Array<{ code: string; reference: string; nbUnites: number; prixCentimes: number }> {
    if (!onglet) return [];
    const references = new Set(articles.map((a) => a.reference));
    const resultats: Array<{ code: string; reference: string; nbUnites: number; prixCentimes: number }> = [];

    for (const ligne of onglet.lignes) {
      const code = champ(ligne, 'CODE PACK', 'CODE');
      const reference = champ(ligne, 'CODE PRODUIT', 'PRODUIT', 'REFERENCE');
      const nb = nombre(champ(ligne, 'NBRE UNITES', 'NB UNITES', 'NOMBRE UNITES', 'QTE'));
      const prix = nombre(champ(ligne, 'PRIX PACK', 'PRIX'));

      if (!code || !reference || !nb || nb <= 0) {
        rapport[onglet.nom].erreurs++;
        anomalies.push(this.anomalie(onglet.nom, ligne, 'CODE PACK', code,
          'PACK_INCOMPLET', 'Code pack, produit de base ou nombre d’unites manquant'));
        continue;
      }
      if (!references.has(reference)) {
        rapport[onglet.nom].erreurs++;
        anomalies.push(this.anomalie(onglet.nom, ligne, 'CODE PRODUIT', reference,
          'PRODUIT_INCONNU', `Produit de base ${reference} inconnu`));
        continue;
      }
      if (!prix || prix <= 0) {
        anomalies.push(this.anomalie(onglet.nom, ligne, 'PRIX PACK', String(prix ?? ''),
          'PRIX_PACK_ABSENT',
          'Pack sans prix : il serait vendu a zero, prix a saisir avant la bascule',
          GraviteAnomalie.AVERTISSEMENT));
      }
      resultats.push({
        code, reference, nbUnites: Math.round(nb),
        prixCentimes: Math.round((prix ?? 0) * 100),
      });
      rapport[onglet.nom].retenus++;
    }
    return resultats;
  }

  private preparerVracs(
    onglet: OngletLu | undefined,
    articles: ArticlePrepare[],
    anomalies: Anomalie[],
    rapport: Record<string, RapportOnglet>,
  ): Array<{ code: string; reference: string; nom: string }> {
    if (!onglet) return [];
    const references = new Set(articles.map((a) => a.reference));
    const resultats: Array<{ code: string; reference: string; nom: string }> = [];

    for (const ligne of onglet.lignes) {
      const code = champ(ligne, 'CODE VRAC', 'CODE');
      const reference = champ(ligne, 'CODE PRODUIT', 'PRODUIT');
      const nom = champ(ligne, 'NOM VRAC', 'NOM', 'DESIGNATION');

      if (!code || !reference) {
        rapport[onglet.nom].erreurs++;
        anomalies.push(this.anomalie(onglet.nom, ligne, 'CODE VRAC', code,
          'VRAC_INCOMPLET', 'Code vrac ou produit manquant'));
        continue;
      }
      if (!references.has(reference)) {
        rapport[onglet.nom].erreurs++;
        anomalies.push(this.anomalie(onglet.nom, ligne, 'CODE PRODUIT', reference,
          'PRODUIT_INCONNU', `Produit ${reference} inconnu`));
        continue;
      }
      resultats.push({ code, reference, nom: nom || code });
      rapport[onglet.nom].retenus++;
    }
    return resultats;
  }

  private preparerTiers(
    onglet: OngletLu | undefined,
    type: TypeTiers,
    anomalies: Anomalie[],
    rapport: Record<string, RapportOnglet>,
  ): Array<{
    code: string; raisonSociale: string; soldeCentimes: number; typeClient: TypeClient | null;
    bloque: boolean; telephone: string; carteFidelite: string | null; ligne: number;
  }> {
    if (!onglet) return [];
    const codesVus = new Map<string, number>();
    const cartesVues = new Map<string, number>();
    const resultats: Array<{
      code: string; raisonSociale: string; soldeCentimes: number; typeClient: TypeClient | null;
      bloque: boolean; telephone: string; carteFidelite: string | null; ligne: number;
    }> = [];

    for (const ligne of onglet.lignes) {
      const code = champ(ligne, 'CODE', 'CODE CLIENT', 'CODE FOURNISSEUR');
      const raisonSociale = champ(ligne, 'RAISON SOCIALE', 'NOM', 'DESIGNATION', 'LIBELLE');

      if (!code) {
        rapport[onglet.nom].erreurs++;
        anomalies.push(this.anomalie(onglet.nom, ligne, 'CODE', '', 'CODE_MANQUANT',
          'Tiers sans code'));
        continue;
      }
      const premiere = codesVus.get(code);
      if (premiere !== undefined) {
        rapport[onglet.nom].erreurs++;
        anomalies.push(this.anomalie(onglet.nom, ligne, 'CODE', code, 'CODE_DOUBLON',
          `Code deja vu ligne ${premiere}`));
        continue;
      }
      codesVus.set(code, ligne.numero);

      // TYPE CLIENT F/C/S : fidelite, client, interne (section 7).
      const typeBrut = champ(ligne, 'TYPE CLIENT', 'TYPE').toUpperCase().slice(0, 1);
      const typeClient =
        type === TypeTiers.CLIENT
          ? typeBrut === 'F'
            ? TypeClient.CARTE_FIDELITE
            : typeBrut === 'S'
              ? TypeClient.INTERNE
              : TypeClient.PARTICULIER
          : null;

      const carte = champ(ligne, 'CARTE FIDELITE', 'CARTE', 'NUM CARTE') || null;
      if (carte) {
        const deja = cartesVues.get(carte);
        if (deja !== undefined) {
          anomalies.push(this.anomalie(onglet.nom, ligne, 'CARTE FIDELITE', carte,
            'CARTE_DOUBLON',
            `Carte deja attribuee ligne ${deja} : elle ne sera pas reprise ici`,
            GraviteAnomalie.AVERTISSEMENT));
        } else {
          cartesVues.set(carte, ligne.numero);
        }
      }

      const solde = Math.round((nombre(champ(ligne, 'SOLDE', 'SOLDE CLIENT', 'SOLDE FOURNISSEUR')) ?? 0) * 100);
      const bloqueBrut = champ(ligne, 'CLIENT BLOQUE', 'BLOQUE').toUpperCase();

      resultats.push({
        code,
        raisonSociale: raisonSociale || code,
        soldeCentimes: solde,
        typeClient,
        bloque: ['O', 'OUI', '1', 'X', 'TRUE', 'VRAI'].includes(bloqueBrut),
        telephone: champ(ligne, 'TELEPHONE', 'TEL', 'MOBILE'),
        carteFidelite: carte && cartesVues.get(carte) === ligne.numero ? carte : null,
        ligne: ligne.numero,
      });
      rapport[onglet.nom].retenus++;
    }
    return resultats;
  }

  private anomalie(
    onglet: string,
    ligne: LigneBrute | null,
    nomChamp: string | null,
    valeur: string,
    code: string,
    message: string,
    gravite: GraviteAnomalie = GraviteAnomalie.ERREUR,
  ): Anomalie {
    return {
      onglet,
      ligne: ligne?.numero ?? null,
      champ: nomChamp,
      valeur: valeur || null,
      gravite,
      code,
      message,
    };
  }

  /**
   * Import definitif.
   *
   * Se fait le soir de la bascule, apres la derniere cloture de caisse de
   * l'ancien logiciel (section 7, deroule 3). Tout passe dans une seule
   * transaction : soit la base est entierement reprise, soit rien n'a
   * bouge et l'on peut recommencer.
   *
   * Les stocks entrent par un mouvement SOLDE_INITIAL, pas par une
   * ecriture directe : le stock reste ainsi egal a la somme de ses
   * mouvements des la premiere seconde.
   */
  async executer(params: {
    tampon: Buffer;
    nomFichier: string;
    magasinId: string;
    emplacementDepotId: string;
    emplacementVenteId: string;
    utilisateurId: string;
    /** Importe malgre des erreurs bloquantes, sous la responsabilite du gerant. */
    forcer?: boolean;
  }) {
    const { resultat, donnees } = await this.preparer(params.tampon);

    const erreurs = resultat.anomalies.filter((a) => a.gravite === GraviteAnomalie.ERREUR);
    if (erreurs.length > 0 && !params.forcer) {
      const session = await this.enregistrerSession({
        nomFichier: params.nomFichier,
        type: TypeImport.BLANC,
        resultat,
        utilisateurId: params.utilisateurId,
        statut: StatutImport.ANNULE,
      });
      return {
        importe: false,
        sessionId: session.id,
        message:
          `${erreurs.length} erreur(s) bloquante(s) : corrigez-les dans le fichier, ` +
          `ou relancez en forcant si vous acceptez de perdre ces lignes.`,
        resultat,
      };
    }

    const debut = Date.now();
    const compteurs = await this.prisma.$transaction(
      async (tx) => {
        // --- Rayons et familles, crees a la volee --------------------
        const rayons = new Map<string, string>();
        const familles = new Map<string, string>();

        for (const article of donnees.articles) {
          if (article.rayon && !rayons.has(article.rayon)) {
            const existant = await tx.rayon.findUnique({ where: { code: article.rayon } });
            rayons.set(
              article.rayon,
              existant?.id ??
                (await tx.rayon.create({
                  data: { code: article.rayon, nom: article.rayon },
                })).id,
            );
          }
          if (article.famille && !familles.has(article.famille)) {
            const existante = await tx.famille.findUnique({ where: { code: article.famille } });
            familles.set(
              article.famille,
              existante?.id ??
                (await tx.famille.create({
                  data: {
                    code: article.famille,
                    nom: article.famille,
                    rayonId: article.rayon ? rayons.get(article.rayon) : undefined,
                  },
                })).id,
            );
          }
        }

        // --- Articles, prix, codes-barres et stock initial ------------
        const parReference = new Map<string, string>();
        let mouvements = 0;

        for (const article of donnees.articles) {
          const cree = await tx.article.create({
            data: {
              reference: article.reference,
              designation: article.designation,
              unite: article.unite,
              decimales: article.decimales,
              tauxTva: article.tauxTva,
              cumpCentimes: b(article.cumpCentimes),
              dernierPrixAchatCentimes: b(article.dernierPrixAchatCentimes),
              rayonId: article.rayon ? rayons.get(article.rayon) : undefined,
              familleId: article.famille ? familles.get(article.famille) : undefined,
              // Les 24 545 articles a stock nul sont archives, pas supprimes :
              // leur historique reste consultable (section 7).
              archive:
                article.stockDepotMilli === 0 &&
                article.stockVenteMilli === 0 &&
                article.prixDetailCentimes === 0,
              importeDepuis: params.nomFichier,
              prix: {
                create: [
                  {
                    categorie: CategoriePrix.DETAIL,
                    prixCentimes: b(article.prixDetailCentimes),
                  },
                  ...(article.prixGrosCentimes
                    ? [{
                        categorie: CategoriePrix.GROS,
                        prixCentimes: b(article.prixGrosCentimes),
                      }]
                    : []),
                  ...(article.prixPackCentimes
                    ? [{
                        categorie: CategoriePrix.PACK,
                        prixCentimes: b(article.prixPackCentimes),
                      }]
                    : []),
                ],
              },
              ...(article.codeBarrePrincipal
                ? {
                    codesBarres: {
                      create: [{
                        code: article.codeBarrePrincipal,
                        type: ean13Valide(article.codeBarrePrincipal) ? 'EAN13' : 'INTERNE',
                        principal: true,
                      }],
                    },
                  }
                : {}),
            },
          });
          parReference.set(article.reference, cree.id);

          const emplacements: Array<[string, number]> = [
            [params.emplacementDepotId, article.stockDepotMilli],
            [params.emplacementVenteId, article.stockVenteMilli],
          ];
          for (const [emplacementId, quantite] of emplacements) {
            await tx.stock.create({
              data: {
                articleId: cree.id,
                emplacementId,
                quantiteMilli: quantite,
                seuilAlerteMilli: article.seuilAlerteMilli,
              },
            });
            if (quantite !== 0) {
              await tx.mouvementStock.create({
                data: {
                  numero: `INIT-${cree.id.slice(0, 8)}-${emplacementId.slice(0, 4)}`,
                  type: 'SOLDE_INITIAL',
                  articleId: cree.id,
                  emplacementId,
                  quantiteMilli: quantite,
                  stockApresMilli: quantite,
                  cumpCentimes: b(article.cumpCentimes),
                  valeurCentimes: b(Math.round((quantite * article.cumpCentimes) / 1000)),
                  documentType: 'IMPORT',
                  documentNumero: params.nomFichier,
                  motif: 'Reprise du stock de l\u2019ancien logiciel',
                  utilisateurId: params.utilisateurId,
                },
              });
              mouvements++;
            }
          }
        }

        // --- Codes-barres secondaires ---------------------------------
        let codes = 0;
        for (const code of donnees.codesBarres) {
          const articleId = parReference.get(code.reference);
          if (!articleId) continue;
          await tx.codeBarre.create({
            data: {
              articleId,
              code: code.code,
              type: ean13Valide(code.code) ? 'EAN13' : 'GENERIQUE',
            },
          });
          codes++;
        }

        // --- Packs : un article a part, lie a son produit de base ------
        let packs = 0;
        for (const pack of donnees.packs) {
          const baseId = parReference.get(pack.reference);
          if (!baseId) continue;
          const base = donnees.articles.find((a) => a.reference === pack.reference);
          await tx.article.create({
            data: {
              reference: `PACK-${pack.code}`,
              designation: `${base?.designation ?? pack.reference} — pack de ${pack.nbUnites}`,
              type: 'PACK',
              unite: 'UN',
              decimales: 0,
              packDeId: baseId,
              packNbUnites: pack.nbUnites,
              cumpCentimes: b((base?.cumpCentimes ?? 0) * pack.nbUnites),
              importeDepuis: params.nomFichier,
              prix: {
                create: [{ categorie: CategoriePrix.PACK, prixCentimes: b(pack.prixCentimes) }],
              },
              codesBarres: { create: [{ code: pack.code, type: 'INTERNE', principal: true }] },
            },
          });
          packs++;
        }

        // --- Vracs : codes de balance ---------------------------------
        let vracs = 0;
        for (const vrac of donnees.vracs) {
          const articleId = parReference.get(vrac.reference);
          if (!articleId) continue;
          await tx.codeVrac.create({
            data: { articleId, code: vrac.code, nom: vrac.nom },
          });
          await tx.article.update({ where: { id: articleId }, data: { estVrac: true } });
          vracs++;
        }

        // --- Tiers et soldes d'ouverture ------------------------------
        let tiers = 0;
        const creerTiers = async (
          liste: typeof donnees.clients,
          type: TypeTiers,
        ) => {
          for (const t of liste) {
            const cree = await tx.tiers.create({
              data: {
                code: t.code,
                type,
                typeClient: t.typeClient,
                raisonSociale: t.raisonSociale,
                telephone: t.telephone || null,
                carteFidelite: t.carteFidelite,
                soldeCentimes: b(t.soldeCentimes),
                soldeOuvertureCentimes: b(t.soldeCentimes),
                bloque: t.bloque,
                motifBlocage: t.bloque ? 'Repris bloque de l\u2019ancien logiciel' : null,
                importeDepuis: params.nomFichier,
              },
            });
            if (t.soldeCentimes !== 0) {
              // Le solde repris est une ecriture du grand livre, pas une
              // valeur posee : le releve de compte reste coherent.
              await tx.mouvementTiers.create({
                data: {
                  tiersId: cree.id,
                  sens: t.soldeCentimes > 0 ? 'DEBIT' : 'CREDIT',
                  montantCentimes: b(Math.abs(t.soldeCentimes)),
                  soldeApresCentimes: b(t.soldeCentimes),
                  categorie: 'SOLDE_OUVERTURE',
                  libelle: 'Solde repris de l\u2019ancien logiciel',
                  documentNumero: params.nomFichier,
                  utilisateurId: params.utilisateurId,
                },
              });
            }
            tiers++;
          }
        };

        await creerTiers(donnees.clients, TypeTiers.CLIENT);
        await creerTiers(donnees.fournisseurs, TypeTiers.FOURNISSEUR);

        return {
          articles: donnees.articles.length,
          codesBarres: codes,
          packs,
          vracs,
          tiers,
          mouvements,
        };
      },
      { timeout: 1000 * 60 * 30, maxWait: 1000 * 60 },
    );

    const session = await this.enregistrerSession({
      nomFichier: params.nomFichier,
      type: TypeImport.DEFINITIF,
      resultat,
      utilisateurId: params.utilisateurId,
    });

    return {
      importe: true,
      sessionId: session.id,
      dureeSecondes: Math.round((Date.now() - debut) / 1000),
      compteurs,
      // Controles de bascule : a comparer avec l'ancien logiciel.
      controles: resultat.controles,
      resultat,
    };
  }

  /**
   * Controles de bascule (section 7, deroule 4) : nombre d'articles,
   * valeur du stock au CUMP, total des soldes clients et fournisseurs,
   * tels qu'ils ressortent de la base apres import.
   */
  async controlesDeBascule() {
    const [articles, stocks, clients, fournisseurs, codes, packs, vracs] = await Promise.all([
      this.prisma.article.count(),
      this.prisma.$queryRaw<Array<{ valeur: string | null }>>`
        SELECT SUM(s."quantiteMilli"::bigint * a."cumpCentimes" / 1000)::text AS valeur
          FROM "Stock" s JOIN "Article" a ON a."id" = s."articleId"`,
      this.prisma.tiers.aggregate({
        where: { type: 'CLIENT' },
        _sum: { soldeCentimes: true },
        _count: true,
      }),
      this.prisma.tiers.aggregate({
        where: { type: 'FOURNISSEUR' },
        _sum: { soldeCentimes: true },
        _count: true,
      }),
      this.prisma.codeBarre.count(),
      this.prisma.article.count({ where: { type: 'PACK' } }),
      this.prisma.codeVrac.count(),
    ]);

    return {
      nombreArticles: articles,
      valeurStockCumpCentimes: Number(stocks[0]?.valeur ?? 0),
      nombreClients: clients._count,
      totalSoldesClientsCentimes: Number(clients._sum.soldeCentimes ?? 0),
      nombreFournisseurs: fournisseurs._count,
      totalSoldesFournisseursCentimes: Number(fournisseurs._sum.soldeCentimes ?? 0),
      nombreCodesBarres: codes,
      nombrePacks: packs,
      nombreVracs: vracs,
    };
  }

  /** Enregistre une session d'import et ses anomalies. */
  async enregistrerSession(params: {
    nomFichier: string;
    type: TypeImport;
    resultat: ResultatAnalyse;
    utilisateurId: string;
    statut?: StatutImport;
  }) {
    const session = await this.prisma.sessionImport.create({
      data: {
        nomFichier: params.nomFichier,
        type: params.type,
        statut: params.statut ?? StatutImport.TERMINE,
        rapport: params.resultat.onglets as unknown as Prisma.InputJsonValue,
        controles: params.resultat.controles as unknown as Prisma.InputJsonValue,
        termineLe: new Date(),
        utilisateurId: params.utilisateurId,
        anomalies: {
          create: params.resultat.anomalies.slice(0, 5000).map((a) => ({
            onglet: a.onglet,
            ligne: a.ligne,
            champ: a.champ,
            valeur: a.valeur,
            gravite: a.gravite,
            code: a.code,
            message: a.message,
          })),
        },
      },
      include: { _count: { select: { anomalies: true } } },
    });

    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: params.type === TypeImport.BLANC ? 'import.a_blanc' : 'import.definitif',
      entite: 'SessionImport',
      entiteId: session.id,
      details: {
        nomFichier: params.nomFichier,
        controles: params.resultat.controles,
        anomalies: session._count.anomalies,
      },
    });

    return session;
  }

  async sessions() {
    return this.prisma.sessionImport.findMany({
      orderBy: { debuteLe: 'desc' },
      take: 50,
      include: {
        utilisateur: { select: { code: true, nom: true } },
        _count: { select: { anomalies: true } },
      },
    });
  }

  async anomalies(sessionId: string, gravite?: GraviteAnomalie) {
    const session = await this.prisma.sessionImport.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session d’import introuvable');

    return this.prisma.anomalieImport.findMany({
      where: { sessionId, ...(gravite ? { gravite } : {}) },
      orderBy: [{ gravite: 'asc' }, { onglet: 'asc' }, { ligne: 'asc' }],
      take: 2000,
    });
  }
}
