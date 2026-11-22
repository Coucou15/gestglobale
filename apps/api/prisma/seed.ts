/**
 * Jeu de donnees de demonstration.
 *
 * Il reproduit la configuration decrite dans le cahier des charges :
 * une superette avec un depot (MC) et une surface de vente (SV), deux
 * caisses actives (n° 2 et 3), et les roles de la section 6.
 *
 * Il ne remplace pas l'import de l'ancien logiciel (section 7) : c'est un
 * socle pour les essais, la formation et la recette.
 */
import { PrismaClient, TypeEmplacement, TypeCompte, CodeRole, TypeTiers, TypeClient, CategoriePrix, UniteMesure, TypeBon, TypeContrat } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const MOT_DE_PASSE_DEMO = 'GestGlobale2026!';
const PIN_DEMO = '1234';

async function main(): Promise<void> {
  console.log('Preparation du jeu de donnees de demonstration...');

  const societe = await prisma.societe.create({
    data: {
      raisonSociale: 'Superette Demo — GestGlobale',
      adresse: 'Alger, Algerie',
      rc: '16/00-0000000 B 00',
      nif: '000000000000000',
      nis: '000000000000000',
      articleImposition: '00000000000',
    },
  });

  const magasin = await prisma.magasin.create({
    data: {
      societeId: societe.id,
      code: 'SV',
      nom: 'Superette principale',
      estSiege: true,
      adresse: 'Alger',
    },
  });

  const depot = await prisma.emplacement.create({
    data: {
      magasinId: magasin.id,
      code: 'MC',
      nom: 'Depot',
      type: TypeEmplacement.DEPOT,
      parDefautReception: true,
    },
  });

  const surfaceVente = await prisma.emplacement.create({
    data: {
      magasinId: magasin.id,
      code: 'SV',
      nom: 'Surface de vente',
      type: TypeEmplacement.SURFACE_VENTE,
      parDefautVente: true,
    },
  });

  // --- Second magasin (M11) --------------------------------------------
  // Le client exploite une chaine : sans deuxieme superette, ni les
  // transferts inter-magasins ni la consolidation ne veulent dire quoi
  // que ce soit. Celle-ci sert a les eprouver.
  const magasinBab = await prisma.magasin.create({
    data: {
      societeId: societe.id,
      code: 'BE',
      nom: 'Superette Bab Ezzouar',
      estSiege: false,
      adresse: 'Bab Ezzouar, Alger',
    },
  });

  const depotBab = await prisma.emplacement.create({
    data: {
      magasinId: magasinBab.id,
      code: 'MC',
      nom: 'Depot',
      type: TypeEmplacement.DEPOT,
      parDefautReception: true,
    },
  });

  const surfaceBab = await prisma.emplacement.create({
    data: {
      magasinId: magasinBab.id,
      code: 'SV',
      nom: 'Surface de vente',
      type: TypeEmplacement.SURFACE_VENTE,
      parDefautVente: true,
    },
  });

  // --- Rayons et familles ---------------------------------------------
  const rayonEpicerie = await prisma.rayon.create({
    data: { code: 'EPI', nom: 'Epicerie', nomAr: 'بقالة', ordre: 1 },
  });
  const rayonFrais = await prisma.rayon.create({
    data: { code: 'FRA', nom: 'Produits frais', nomAr: 'طازج', ordre: 2 },
  });

  const familleHuiles = await prisma.famille.create({
    data: { code: 'HUI', nom: 'Huiles et condiments', rayonId: rayonEpicerie.id },
  });
  const familleLaitiers = await prisma.famille.create({
    data: {
      code: 'LAI',
      nom: 'Produits laitiers',
      rayonId: rayonFrais.id,
      suiviPeremption: true,
      joursAlertePeremption: 5,
    },
  });
  const familleFruits = await prisma.famille.create({
    data: { code: 'FRU', nom: 'Fruits et legumes', rayonId: rayonFrais.id },
  });

  // --- Utilisateurs (les 11 comptes de l'ancien logiciel) -------------
  const empreinteMdp = await argon2.hash(MOT_DE_PASSE_DEMO, { type: argon2.argon2id });
  const empreintePin = await argon2.hash(PIN_DEMO, { type: argon2.argon2id });

  const comptes: Array<{ code: string; nom: string; login: string; role: CodeRole }> = [
    { code: '1', nom: 'Gerant', login: 'gerant', role: CodeRole.GERANT },
    { code: '2', nom: 'Chef de caisse', login: 'chef.caisse', role: CodeRole.CHEF_DE_CAISSE },
    { code: '3', nom: 'Caissier 1', login: 'caissier1', role: CodeRole.CAISSIER },
    { code: '4', nom: 'Caissier 2', login: 'caissier2', role: CodeRole.CAISSIER },
    { code: '5', nom: 'Caissier 3', login: 'caissier3', role: CodeRole.CAISSIER },
    { code: '6', nom: 'Magasinier 1', login: 'magasinier1', role: CodeRole.MAGASINIER },
    { code: '7', nom: 'Magasinier 2', login: 'magasinier2', role: CodeRole.MAGASINIER },
    { code: '8', nom: 'Acheteur', login: 'acheteur', role: CodeRole.ACHETEUR },
    { code: '9', nom: 'Comptable', login: 'comptable', role: CodeRole.COMPTABLE },
    { code: '10', nom: 'Caissier 4', login: 'caissier4', role: CodeRole.CAISSIER },
    { code: '11', nom: 'Caissier 5', login: 'caissier5', role: CodeRole.CAISSIER },
  ];

  for (const compte of comptes) {
    await prisma.utilisateur.create({
      data: {
        ...compte,
        motDePasseHash: empreinteMdp,
        pinHash: empreintePin,
        importeDepuis: 'ancien logiciel',
        magasins: {
          create: compte.login === 'gerant' || compte.login === 'comptable'
            // Le gerant consolide et le comptable tient les journaux des
            // deux magasins : il leur faut l'un et l'autre.
            ? [{ magasinId: magasin.id }, { magasinId: magasinBab.id }]
            : [{ magasinId: magasin.id }],
        },
      },
    });
  }

  const gerant = await prisma.utilisateur.findUniqueOrThrow({ where: { login: 'gerant' } });

  // --- Caisses n° 2 et 3, comme dans l'export -------------------------
  const caisse2 = await prisma.caisse.create({
    data: { magasinId: magasin.id, numero: 2, libelle: 'Caisse 2' },
  });
  const caisse3 = await prisma.caisse.create({
    data: { magasinId: magasin.id, numero: 3, libelle: 'Caisse 3' },
  });

  // --- Comptes de tresorerie ------------------------------------------
  await prisma.compteTresorerie.createMany({
    data: [
      { code: 'TIR-2', libelle: 'Tiroir caisse 2', type: TypeCompte.TIROIR, magasinId: magasin.id, caisseId: caisse2.id },
      { code: 'TIR-3', libelle: 'Tiroir caisse 3', type: TypeCompte.TIROIR, magasinId: magasin.id, caisseId: caisse3.id },
      { code: 'COF', libelle: 'Coffre', type: TypeCompte.COFFRE, magasinId: magasin.id },
      { code: 'BNQ', libelle: 'Banque', type: TypeCompte.BANQUE, magasinId: magasin.id, banque: 'BNA' },
      { code: 'COF-BE', libelle: 'Coffre Bab Ezzouar', type: TypeCompte.COFFRE, magasinId: magasinBab.id },
      // Compte du siege : il n'appartient a aucun magasin et ne doit
      // donc etre impute a aucun dans la consolidation.
      { code: 'BNQ-SIEGE', libelle: 'Banque du siege', type: TypeCompte.BANQUE, banque: 'BEA' },
    ],
  });

  const caisseBab = await prisma.caisse.create({
    data: { magasinId: magasinBab.id, numero: 1, libelle: 'Caisse 1' },
  });
  await prisma.compteTresorerie.create({
    data: {
      code: 'TIR-BE-1', libelle: 'Tiroir Bab Ezzouar', type: TypeCompte.TIROIR,
      magasinId: magasinBab.id, caisseId: caisseBab.id,
    },
  });

  // --- Parametres ------------------------------------------------------
  await prisma.parametre.createMany({
    data: [
      {
        cle: 'stock.negatif_autorise',
        valeur: false,
        description: 'Interdit la vente au-dela du stock disponible (M2)',
      },
      {
        cle: 'caisse.timbre',
        valeur: {
          actif: false,
          tauxPourcent: 1,
          minimumCentimes: 500,
          maximumCentimes: 250000,
          arrondiCentimes: 100,
          modesSoumis: ['ESPECES'],
        },
        description: 'Droit de timbre — taux et plafonds a confirmer avec le comptable',
      },
      {
        cle: 'caisse.remise_plafond_pourcent',
        valeur: 5,
        description: 'Remise maximale sans code superviseur, par ligne ou par ticket',
      },
      {
        cle: 'caisse.intervalle_descente_secondes',
        valeur: 120,
        description: 'Frequence de recuperation du catalogue par la caisse (section 4.1)',
      },
    ],
  });

  // --- Articles ---------------------------------------------------------
  interface ArticleDemo {
    reference: string;
    designation: string;
    designationAr?: string;
    unite: UniteMesure;
    decimales: number;
    familleId: string;
    rayonId: string;
    codesBarres: string[];
    prixDetail: number;
    cump: number;
    stockDepot: number;
    stockVente: number;
    estVrac?: boolean;
    gestionLot?: boolean;
  }

  const articles: ArticleDemo[] = [
    {
      reference: 'ART0001', designation: 'Huile de table 5 L', designationAr: 'زيت المائدة 5 ل',
      unite: UniteMesure.UN, decimales: 0, familleId: familleHuiles.id, rayonId: rayonEpicerie.id,
      codesBarres: ['6130000000017', '6130000000024'],
      prixDetail: 75000, cump: 62000, stockDepot: 120, stockVente: 24,
    },
    {
      reference: 'ART0002', designation: 'Semoule fine 10 kg', designationAr: 'سميد رقيق 10 كغ',
      unite: UniteMesure.UN, decimales: 0, familleId: familleHuiles.id, rayonId: rayonEpicerie.id,
      codesBarres: ['6130000000031'],
      prixDetail: 95000, cump: 81000, stockDepot: 60, stockVente: 12,
    },
    {
      reference: 'ART0003', designation: 'Lait UHT 1 L', designationAr: 'حليب 1 ل',
      unite: UniteMesure.UN, decimales: 0, familleId: familleLaitiers.id, rayonId: rayonFrais.id,
      codesBarres: ['6130000000048'],
      prixDetail: 13000, cump: 10500, stockDepot: 300, stockVente: 96,
      gestionLot: true,
    },
    {
      reference: 'ART0004', designation: 'Yaourt nature x4', unite: UniteMesure.UN, decimales: 0,
      familleId: familleLaitiers.id, rayonId: rayonFrais.id,
      codesBarres: ['6130000000055'],
      prixDetail: 16000, cump: 12800, stockDepot: 140, stockVente: 40,
      gestionLot: true,
    },
    {
      reference: 'ART0005', designation: 'Pommes de terre', designationAr: 'بطاطا',
      unite: UniteMesure.KG, decimales: 3, familleId: familleFruits.id, rayonId: rayonFrais.id,
      codesBarres: [], prixDetail: 9000, cump: 6500,
      stockDepot: 500, stockVente: 120, estVrac: true,
    },
    {
      reference: 'ART0006', designation: 'Tomates fraiches', unite: UniteMesure.KG, decimales: 3,
      familleId: familleFruits.id, rayonId: rayonFrais.id,
      codesBarres: [], prixDetail: 14000, cump: 9800,
      stockDepot: 200, stockVente: 60, estVrac: true,
    },
    {
      reference: 'ART0007', designation: 'Pain', unite: UniteMesure.UN, decimales: 0,
      familleId: familleHuiles.id, rayonId: rayonEpicerie.id,
      codesBarres: [], prixDetail: 1500, cump: 1000, stockDepot: 0, stockVente: 200,
    },
  ];

  const creees = new Map<string, string>();
  for (const a of articles) {
    const article = await prisma.article.create({
      data: {
        reference: a.reference,
        designation: a.designation,
        designationAr: a.designationAr,
        unite: a.unite,
        decimales: a.decimales,
        familleId: a.familleId,
        rayonId: a.rayonId,
        tauxTva: 0,
        estVrac: a.estVrac ?? false,
        gestionLot: a.gestionLot ?? false,
        joursAlertePeremption: a.gestionLot ? 5 : 0,
        cumpCentimes: BigInt(a.cump),
        dernierPrixAchatCentimes: BigInt(a.cump),
        codesBarres: {
          create: a.codesBarres.map((code, index) => ({
            code,
            type: 'EAN13',
            principal: index === 0,
          })),
        },
        prix: {
          create: [
            { categorie: CategoriePrix.DETAIL, prixCentimes: BigInt(a.prixDetail) },
            { categorie: CategoriePrix.GROS, prixCentimes: BigInt(Math.round(a.prixDetail * 0.92)) },
          ],
        },
        stocks: {
          create: [
            {
              emplacementId: depot.id,
              quantiteMilli: a.stockDepot * 1000,
              seuilAlerteMilli: 20 * 1000,
            },
            {
              emplacementId: surfaceVente.id,
              quantiteMilli: a.stockVente * 1000,
              seuilAlerteMilli: 10 * 1000,
              capaciteMilli: 60 * 1000,
            },
          ],
        },
      },
    });
    creees.set(a.reference, article.id);
  }

  // Codes vrac pour les articles au poids (balance).
  await prisma.codeVrac.createMany({
    data: [
      { articleId: creees.get('ART0005') as string, code: '00005', nom: 'POMMES DE TERRE' },
      { articleId: creees.get('ART0006') as string, code: '00006', nom: 'TOMATES' },
    ],
  });

  // Pack : carton de 12 laits, decremente 12 unites du lait a la vente.
  const lait = creees.get('ART0003') as string;
  await prisma.article.create({
    data: {
      reference: 'PACK0001',
      designation: 'Lait UHT — carton de 12',
      type: 'PACK',
      unite: UniteMesure.UN,
      decimales: 0,
      familleId: familleLaitiers.id,
      rayonId: rayonFrais.id,
      packDeId: lait,
      packNbUnites: 12,
      cumpCentimes: BigInt(10500 * 12),
      codesBarres: { create: [{ code: '6130000000062', type: 'EAN13', principal: true }] },
      prix: { create: [{ categorie: CategoriePrix.PACK, prixCentimes: BigInt(148000) }] },
    },
  });

  // --- Promotions (M10) ---------------------------------------------------
  // Une de chaque sorte, pour que la caisse soit eprouvee sur les quatre.
  const debutPromo = new Date();
  debutPromo.setDate(debutPromo.getDate() - 1);
  const finPromo = new Date();
  finPromo.setDate(finPromo.getDate() + 30);

  await prisma.promotion.createMany({
    data: [
      {
        code: 'PROMO-HUILE', libelle: 'Huile a 690 DA', type: 'PRIX_BARRE',
        debut: debutPromo, fin: finPromo,
        articleId: creees.get('ART0001') as string,
        valeurCentimes: BigInt(69000), cumulable: false,
      },
      {
        code: 'PROMO-LAIT', libelle: 'Deux laits achetes, un offert', type: 'X_POUR_Y',
        debut: debutPromo, fin: finPromo,
        articleId: creees.get('ART0003') as string,
        quantiteDeclenchement: 2, quantiteOfferte: 1, cumulable: false,
      },
      {
        code: 'PROMO-FRUITS', libelle: 'Fruits et legumes a -10 %', type: 'REMISE_FAMILLE',
        debut: debutPromo, fin: finPromo,
        familleId: familleFruits.id, remisePourcent: 10, cumulable: false,
      },
      {
        code: 'PROMO-SOIR', libelle: 'Happy hour du soir', type: 'HAPPY_HOUR',
        debut: debutPromo, fin: finPromo,
        familleId: familleLaitiers.id, remisePourcent: 5,
        heureDebut: '18:00', heureFin: '20:00', cumulable: true,
      },
    ],
  });

  await prisma.parametre.create({
    data: {
      cle: 'caisse.fidelite',
      valeur: {
        actif: true,
        centimesParPoint: 10000,
        valeurPointCentimes: 100,
        minimumUtilisation: 50,
      },
      description: 'Bareme de fidelite : un point par 100 DA depenses (M10)',
    },
  });

  await prisma.parametre.create({
    data: {
      cle: 'rapports.resumeQuotidien',
      valeur: {
        // Desactive tant que le client n'a pas fourni de relais de
        // messagerie. Le resume est produit et conserve quand meme : le
        // gerant le lit dans le back-office.
        actif: false,
        heure: 7,
      },
      description:
        "Resume quotidien du gerant (M9). Renseignez hote, port, utilisateur, "
        + "motDePasse et expediteur, puis passez actif a true.",
    },
  });

  // --- Personnel (M13) ---------------------------------------------------
  // Les comptes de caisse existent deja ; on leur donne un dossier
  // d'employe, pour que le pointage, la paie et la performance aient de
  // quoi s'accrocher.
  const bareme = {
    cotisationSalarialePourcent: 9,
    cotisationPatronalePourcent: 26,
    tranchesIrg: [
      { plafondCentimes: 2000000, tauxPourcent: 0 },
      { plafondCentimes: 4000000, tauxPourcent: 20 },
      { plafondCentimes: 8000000, tauxPourcent: 30 },
      { plafondCentimes: null, tauxPourcent: 35 },
    ],
    heuresParSemaine: 40,
    majorationHeureSupPourcent: 50,
    // Retenir un ecart de caisse sur un salaire est un acte grave : il
    // reste desactive tant que le client ne l'a pas decide.
    retenirEcartsDeCaisse: false,
    primesExonerees: ['PANIER', 'TRANSPORT'],
  };
  await prisma.parametre.create({
    data: {
      cle: 'paie.bareme',
      valeur: bareme,
      description:
        'Bareme de paie (M13) : cotisations, tranches d\u2019IRG et majoration des '
        + 'heures supplementaires. Valeurs plausibles pour l\u2019Algerie, '
        + 'A VALIDER PAR LE COMPTABLE avant la premiere paie.',
    },
  });

  const personnel = [
    {
      matricule: 'E0001', nom: 'Benali', prenom: 'Karim', poste: 'Caissier',
      login: 'caissier1', salaireBaseCentimes: 4000000,
      type: TypeContrat.CDI, finDansJours: null,
    },
    {
      matricule: 'E0002', nom: 'Haddad', prenom: 'Samia', poste: 'Caissiere',
      login: 'caissier2', salaireBaseCentimes: 4000000,
      type: TypeContrat.CDD, finDansJours: 20,
    },
    {
      matricule: 'E0003', nom: 'Cherif', prenom: 'Nadia', poste: 'Magasinier',
      login: 'magasinier1', salaireBaseCentimes: 3800000,
      type: TypeContrat.ESSAI, finDansJours: 12,
    },
    {
      matricule: 'E0004', nom: 'Ziani', prenom: 'Omar', poste: 'Agent de rayon',
      login: null, salaireBaseCentimes: 2600000, type: TypeContrat.TEMPS_PARTIEL,
      finDansJours: null, heuresParSemaine: 20,
    },
  ];

  for (const p of personnel) {
    const employe = await prisma.employe.create({
      data: {
        matricule: p.matricule,
        nom: p.nom,
        prenom: p.prenom,
        poste: p.poste,
        magasinId: magasin.id,
        dateEmbauche: new Date(Date.now() - 400 * 86400000),
        nin: `10${p.matricule.slice(1)}000000000`,
        numeroSecuriteSociale: `99${p.matricule.slice(1)}0000`,
        telephone: '05' + p.matricule.slice(1) + '00000',
        soldeCongesJours: 30,
      },
    });

    await prisma.contrat.create({
      data: {
        employeId: employe.id,
        type: p.type,
        debut: new Date(Date.now() - 400 * 86400000),
        fin: p.finDansJours === null
          ? null
          : new Date(Date.now() + p.finDansJours * 86400000),
        salaireBaseCentimes: BigInt(p.salaireBaseCentimes),
        heuresParSemaine: p.heuresParSemaine ?? 40,
        primesFixes: [
          { code: 'PANIER', libelle: 'Prime de panier', montantCentimes: 500000 },
          { code: 'TRANSPORT', libelle: 'Prime de transport', montantCentimes: 300000 },
        ],
      },
    });

    // Rattachement au compte utilisateur : un depart coupera ses acces.
    //
    // Sans .catch() : un rattachement qui echoue doit faire echouer le
    // jeu d'essai. Le silencer laissait croire que le lien existait
    // alors qu'aucun dossier n'etait rattache a son compte.
    if (p.login) {
      await prisma.utilisateur.update({
        where: { login: p.login },
        data: { employeId: employe.id },
      });
    }
  }

  // --- Cartes cadeaux et bons d'achat (M10) ------------------------------
  // Trois cartes de 1 000 DA et deux bons de 500 DA, de quoi essayer un
  // reglement par bon en caisse, hors ligne comme en ligne.
  const dansUnAn = new Date(Date.now() + 365 * 86400000);
  const annee = new Date().getFullYear();
  const codeBon = (prefixe: string, n: number) =>
    `${prefixe}-${annee}-${String(n).padStart(6, '0')}`;
  await prisma.bonAchat.createMany({
    data: [
      ...[1, 2, 3].map((n) => ({
        code: codeBon('CAD', n),
        type: TypeBon.CARTE_CADEAU,
        montantCentimes: BigInt(100000),
        soldeCentimes: BigInt(100000),
        expireLe: dansUnAn,
      })),
      ...[1, 2].map((n) => ({
        code: codeBon('BON', n),
        type: TypeBon.BON_ACHAT,
        montantCentimes: BigInt(50000),
        soldeCentimes: BigInt(50000),
        expireLe: dansUnAn,
      })),
    ],
  });
  // Les compteurs repartent apres les codes du jeu d'essai : sans cela, la
  // premiere emission reelle tomberait sur un code deja pris.
  await prisma.compteur.createMany({
    data: [
      { cle: `CAD.${annee}`, valeur: 3 },
      { cle: `BON.${annee}`, valeur: 2 },
    ],
    skipDuplicates: true,
  });

  // --- Tiers -------------------------------------------------------------
  await prisma.tiers.createMany({
    data: [
      {
        code: 'F0001', type: TypeTiers.FOURNISSEUR, raisonSociale: 'Grossiste Centre',
        telephone: '0550000001', soldeCentimes: BigInt(0),
      },
      {
        code: 'F0002', type: TypeTiers.FOURNISSEUR, raisonSociale: 'Laiterie Regionale',
        telephone: '0550000002', soldeCentimes: BigInt(0),
      },
      {
        code: 'C0001', type: TypeTiers.CLIENT, typeClient: TypeClient.PROFESSIONNEL,
        raisonSociale: 'Cafeteria El Bahdja', telephone: '0660000001',
        categoriePrix: CategoriePrix.GROS, plafondCreditCentimes: BigInt(5000000),
        rc: '16/00-1111111 B 11', nif: '111111111111111',
      },
      {
        code: 'C0002', type: TypeTiers.CLIENT, typeClient: TypeClient.CARTE_FIDELITE,
        raisonSociale: 'Client fidelite 0002', carteFidelite: 'FID0002',
        pointsFidelite: 120,
      },
      {
        code: 'C0003', type: TypeTiers.CLIENT, typeClient: TypeClient.PARTICULIER,
        raisonSociale: 'Client comptant', plafondCreditCentimes: BigInt(0),
      },
    ],
  });

  console.log(`
Jeu de donnees cree.

  Magasins       : ${magasin.code} — ${magasin.nom} (siege)
                   ${magasinBab.code} — ${magasinBab.nom}
  Emplacements   : ${depot.code} (depot), ${surfaceVente.code} (surface de vente)
  Caisses        : 2 et 3 a ${magasin.code}, 1 a ${magasinBab.code}
  Utilisateurs   : ${comptes.length} (codes 1 a 11)
  Articles       : ${articles.length} + 1 pack
  Promotions     : 4 (prix barre, X pour Y, remise famille, happy hour)
  Bons d'achat   : ${codeBon('CAD', 1)} a ${codeBon('CAD', 3)} (1 000 DA),
                   ${codeBon('BON', 1)} et ${codeBon('BON', 2)} (500 DA)
  Personnel      : 4 employes, dont un CDD et un essai a echeance proche
  Gerant         : login "gerant", mot de passe "${MOT_DE_PASSE_DEMO}"
  Caisse         : code "3", PIN "${PIN_DEMO}"

  Ces identifiants sont ceux d'une base de demonstration.
  A l'installation chez le client, changez-les avant la mise en service.
`);
  void gerant;
  void depotBab;
  void surfaceBab;
}

main()
  .catch((erreur) => {
    console.error(erreur);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
