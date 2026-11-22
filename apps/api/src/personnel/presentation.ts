import { formaterDA } from '@gestglobale/shared';
import { formaterJour, type Rapport } from '../rapports/tableau';

/**
 * Documents du personnel (M13).
 *
 * Bulletin de paie, livre de paie, attestation et certificat de
 * travail. Comme ailleurs, une seule description par document sert
 * l'ecran et les exports.
 */

const DA = (centimes: number) => formaterDA(centimes, { devise: true });

const MOIS = [
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
];

export function nomDuMois(mois: number): string {
  return MOIS[mois - 1] ?? String(mois);
}

/**
 * Bulletin de paie.
 *
 * En portrait : c'est une piece qu'on remet a une personne, qu'elle
 * plie et qu'elle classe. Chaque ligne du calcul y figure dans l'ordre
 * ou elle s'applique, pour que l'employe puisse refaire l'operation.
 */
export function bulletinDePaie(donnees: {
  numero: string;
  periodeAnnee: number;
  periodeMois: number;
  employe: Record<string, any>;
  salaireBaseCentimes: number;
  heuresSupplementaires: number;
  heuresSupCentimes: number;
  primesCentimes: number;
  brutCentimes: number;
  cotisationsCentimes: number;
  irgCentimes: number;
  retenues: Array<{ libelle: string; montantCentimes: number; origine: string }>;
  retenuesCentimes: number;
  netAPayerCentimes: number;
  payeLe: Date | string | null;
  tauxAppliques?: Record<string, any> | null;
}): Rapport {
  const taux = donnees.tauxAppliques ?? {};
  const lignes: Array<Record<string, unknown>> = [
    { libelle: 'Salaire de base', montantCentimes: donnees.salaireBaseCentimes },
  ];
  if (donnees.heuresSupCentimes > 0) {
    lignes.push({
      libelle: `Heures supplementaires (${donnees.heuresSupplementaires} h`
        + `, majorees de ${taux.majorationHeureSupPourcent ?? 50} %)`,
      montantCentimes: donnees.heuresSupCentimes,
    });
  }
  if (donnees.primesCentimes > 0) {
    lignes.push({ libelle: 'Primes', montantCentimes: donnees.primesCentimes });
  }
  lignes.push({ libelle: 'Salaire brut', montantCentimes: donnees.brutCentimes });
  lignes.push({
    libelle: `Cotisations sociales (${taux.cotisationSalarialePourcent ?? 9} %)`,
    montantCentimes: -donnees.cotisationsCentimes,
  });
  lignes.push({
    libelle: 'Impot sur le revenu',
    montantCentimes: -donnees.irgCentimes,
  });
  for (const retenue of donnees.retenues) {
    lignes.push({
      libelle: retenue.libelle,
      montantCentimes: -retenue.montantCentimes,
    });
  }

  return {
    titre: 'Bulletin de paie',
    sousTitre: `${nomDuMois(donnees.periodeMois)} ${donnees.periodeAnnee}`
      + ` — ${donnees.numero}`,
    enTete: [
      {
        intitule: 'Employe',
        valeur: `${donnees.employe.prenom} ${donnees.employe.nom}`,
      },
      { intitule: 'Matricule', valeur: donnees.employe.matricule },
      { intitule: 'Poste', valeur: donnees.employe.poste ?? '—' },
      {
        intitule: 'N° securite sociale',
        valeur: donnees.employe.numeroSecuriteSociale ?? '—',
      },
      { intitule: 'Net a payer', valeur: DA(donnees.netAPayerCentimes) },
      {
        intitule: 'Verse le',
        valeur: donnees.payeLe ? formaterJour(donnees.payeLe) : 'non verse',
      },
    ],
    blocs: [{
      titre: 'Detail du calcul',
      colonnes: [
        { cle: 'libelle', titre: 'Libelle', largeur: 42 },
        { cle: 'montantCentimes', titre: 'Montant', sorte: 'montant', largeur: 18 },
      ],
      lignes,
      total: { libelle: 'NET A PAYER', montantCentimes: donnees.netAPayerCentimes },
    }],
    note:
      'Les taux de cotisations et d’impot appliques a ce bulletin y sont conserves : '
      + 'il reste justifiable tel quel, meme apres un changement de bareme. Ces taux '
      + 'doivent etre valides par le comptable de l’entreprise.',
  };
}

export function livreDePaie(donnees: {
  periode: { annee: number; mois: number };
  lignes: Array<Record<string, unknown>>;
  totaux: Record<string, number>;
}): Rapport {
  return {
    titre: 'Livre de paie',
    sousTitre: `${nomDuMois(donnees.periode.mois)} ${donnees.periode.annee}`,
    enTete: [
      { intitule: 'Bulletins', valeur: String(donnees.totaux.nombreBulletins) },
      { intitule: 'Dont verses', valeur: String(donnees.totaux.nombreVerses) },
      { intitule: 'Masse salariale brute', valeur: DA(donnees.totaux.brutCentimes) },
      { intitule: 'Net a payer', valeur: DA(donnees.totaux.netAPayerCentimes) },
    ],
    blocs: [{
      colonnes: [
        { cle: 'matricule', titre: 'Matricule', largeur: 11 },
        { cle: 'nom', titre: 'Employe', largeur: 24 },
        { cle: 'poste', titre: 'Poste', largeur: 16 },
        { cle: 'magasin', titre: 'Mag.', largeur: 7 },
        { cle: 'salaireBaseCentimes', titre: 'Base', sorte: 'montant', largeur: 14 },
        { cle: 'heuresSupCentimes', titre: 'Heures sup.', sorte: 'montant', largeur: 13 },
        { cle: 'primesCentimes', titre: 'Primes', sorte: 'montant', largeur: 12 },
        { cle: 'brutCentimes', titre: 'Brut', sorte: 'montant', largeur: 14 },
        { cle: 'cotisationsCentimes', titre: 'Cotisations', sorte: 'montant', largeur: 13 },
        { cle: 'irgCentimes', titre: 'IRG', sorte: 'montant', largeur: 12 },
        { cle: 'retenuesCentimes', titre: 'Retenues', sorte: 'montant', largeur: 12 },
        { cle: 'netAPayerCentimes', titre: 'Net a payer', sorte: 'montant', largeur: 15 },
      ],
      lignes: donnees.lignes,
      total: {
        matricule: 'Total',
        salaireBaseCentimes: donnees.totaux.salaireBaseCentimes,
        heuresSupCentimes: donnees.totaux.heuresSupCentimes,
        primesCentimes: donnees.totaux.primesCentimes,
        brutCentimes: donnees.totaux.brutCentimes,
        cotisationsCentimes: donnees.totaux.cotisationsCentimes,
        irgCentimes: donnees.totaux.irgCentimes,
        retenuesCentimes: donnees.totaux.retenuesCentimes,
        netAPayerCentimes: donnees.totaux.netAPayerCentimes,
      },
      siVide: 'Aucun bulletin etabli pour ce mois.',
    }],
  };
}

/**
 * Attestation ou certificat de travail.
 *
 * Une attestation se delivre a un salarie en poste, un certificat a
 * celui qui part : les deux ne disent pas la meme chose et ne se
 * confondent pas.
 */
export function attestationDeTravail(donnees: {
  employe: Record<string, any>;
  societe: Record<string, any>;
  contrat: Record<string, any> | null;
  certificat: boolean;
}): Rapport {
  const e = donnees.employe;
  const nomComplet = `${e.prenom} ${e.nom}`;
  const embauche = e.dateEmbauche ? formaterJour(e.dateEmbauche) : '—';

  const corps = donnees.certificat
    ? `Nous soussignes, ${donnees.societe.raisonSociale}, certifions que `
      + `${nomComplet}, titulaire du numero d’identification national `
      + `${e.nin ?? '—'}, a ete employe(e) au sein de notre entreprise `
      + `du ${embauche} au ${e.dateSortie ? formaterJour(e.dateSortie) : '—'}, `
      + `en qualite de ${e.poste ?? '—'}.\n\n`
      + 'Le present certificat lui est delivre pour servir et valoir ce que de droit.'
    : `Nous soussignes, ${donnees.societe.raisonSociale}, attestons que `
      + `${nomComplet}, titulaire du numero d’identification national `
      + `${e.nin ?? '—'}, est employe(e) au sein de notre entreprise `
      + `depuis le ${embauche}, en qualite de ${e.poste ?? '—'}`
      + (donnees.contrat ? `, sous contrat ${donnees.contrat.type}` : '')
      + '.\n\n'
      + 'La presente attestation lui est delivree pour servir et valoir ce que de droit.';

  return {
    titre: donnees.certificat ? 'Certificat de travail' : 'Attestation de travail',
    sousTitre: donnees.societe.raisonSociale,
    blocs: [{
      colonnes: [
        { cle: 'intitule', titre: 'Renseignement', largeur: 26 },
        { cle: 'valeur', titre: '', largeur: 40 },
      ],
      lignes: [
        { intitule: 'Nom et prenom', valeur: nomComplet },
        { intitule: 'Matricule', valeur: e.matricule },
        { intitule: 'N° identification national', valeur: e.nin ?? '—' },
        { intitule: 'N° securite sociale', valeur: e.numeroSecuriteSociale ?? '—' },
        { intitule: 'Poste occupe', valeur: e.poste ?? '—' },
        { intitule: 'Date d’embauche', valeur: embauche },
        ...(donnees.certificat
          ? [{
            intitule: 'Date de sortie',
            valeur: e.dateSortie ? formaterJour(e.dateSortie) : '—',
          }]
          : []),
        ...(donnees.contrat
          ? [{ intitule: 'Nature du contrat', valeur: donnees.contrat.type }]
          : []),
      ],
    }],
    note: `${corps}\n\nFait le ${formaterJour(new Date())}.`,
  };
}

export function performance(donnees: {
  periode: { debut: Date; fin: Date };
  lignes: Array<Record<string, unknown>>;
}): Rapport {
  const fin = new Date(new Date(donnees.periode.fin).getTime() - 1);
  return {
    titre: 'Performance du personnel',
    sousTitre: `Du ${formaterJour(donnees.periode.debut)} au ${formaterJour(fin)}`,
    blocs: [{
      colonnes: [
        { cle: 'matricule', titre: 'Matricule', largeur: 11 },
        { cle: 'nom', titre: 'Employe', largeur: 22 },
        { cle: 'poste', titre: 'Poste', largeur: 15 },
        { cle: 'nombreTickets', titre: 'Tickets', sorte: 'nombre', largeur: 10 },
        { cle: 'chiffreAffairesCentimes', titre: 'CA encaisse', sorte: 'montant', largeur: 15 },
        { cle: 'panierMoyenCentimes', titre: 'Panier moyen', sorte: 'montant', largeur: 14 },
        { cle: 'nombreAnnulations', titre: 'Annulations', sorte: 'nombre', largeur: 12 },
        { cle: 'remisesAccordeesCentimes', titre: 'Remises', sorte: 'montant', largeur: 13 },
        { cle: 'ecartCumuleCentimes', titre: 'Ecart caisse', sorte: 'montant', largeur: 14 },
        { cle: 'joursPointes', titre: 'Jours', sorte: 'nombre', largeur: 9 },
        { cle: 'heuresTravaillees', titre: 'Heures', largeur: 10 },
        { cle: 'nombreRetards', titre: 'Retards', sorte: 'nombre', largeur: 10 },
      ],
      lignes: donnees.lignes,
      siVide: 'Aucun employe sur la periode.',
    }],
    note:
      'Ces chiffres se lisent ensemble. Un caissier rapide qui annule beaucoup n’est '
      + 'pas forcement un bon caissier, et un ecart de caisse est en partie structurel : '
      + 'un total de ticket tombe sur n’importe quel centime alors que la plus petite '
      + 'coupure vaut 5 DA. Ce qui se lit ici, c’est une derive, jamais une faute.',
  };
}
