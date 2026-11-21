import { formaterDA, formaterQuantite, type UniteMesure, type TicketSync } from '@gestglobale/shared';

/**
 * Composition du ticket pour une imprimante thermique 80 mm (M4).
 *
 * Le rendu est produit en texte et en commandes ESC/POS. Le texte sert a
 * l'apercu a l'ecran et au double en PDF ; les commandes partent sur le
 * port de l'imprimante.
 */

const LARGEUR = 42; // colonnes d'une 80 mm en police A

/** Avantage promotionnel a faire figurer sous une ligne du ticket. */
export interface AvantageTicket {
  numeroLigne: number;
  libelle: string;
  remiseCentimes: number;
  unitesOffertesMilli: number;
}

export interface EnteteTicket {
  raisonSociale: string;
  adresse?: string;
  telephone?: string;
  rc?: string;
  nif?: string;
  nis?: string;
  articleImposition?: string;
  codeMagasin: string;
  numeroCaisse: number;
  nomCaissier: string;
}

function centrer(texte: string): string {
  const t = texte.slice(0, LARGEUR);
  const marge = Math.max(0, Math.floor((LARGEUR - t.length) / 2));
  return ' '.repeat(marge) + t;
}

function deuxColonnes(gauche: string, droite: string): string {
  const d = droite.slice(0, LARGEUR);
  const g = gauche.slice(0, Math.max(0, LARGEUR - d.length - 1));
  return g + ' '.repeat(Math.max(1, LARGEUR - g.length - d.length)) + d;
}

const SEPARATEUR = '-'.repeat(LARGEUR);

export function composerTicket(
  ticket: TicketSync,
  entete: EnteteTicket,
  options: {
    unites?: Record<string, UniteMesure>;
    nomClient?: string | null;
    avantages?: AvantageTicket[];
    pointsGagnes?: number;
    pointsTotal?: number;
  } = {},
): string {
  const lignes: string[] = [];

  lignes.push(centrer(entete.raisonSociale.toUpperCase()));
  if (entete.adresse) lignes.push(centrer(entete.adresse));
  if (entete.telephone) lignes.push(centrer(`Tel : ${entete.telephone}`));
  // Mentions legales exigees par la section 8 (conformite).
  if (entete.rc) lignes.push(centrer(`RC : ${entete.rc}`));
  if (entete.nif) lignes.push(centrer(`NIF : ${entete.nif}`));
  if (entete.nis) lignes.push(centrer(`NIS : ${entete.nis}`));
  if (entete.articleImposition) lignes.push(centrer(`Art. imp. : ${entete.articleImposition}`));
  lignes.push(SEPARATEUR);

  const date = new Date(ticket.dateVente);
  const jour = date.toLocaleDateString('fr-DZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const heure = date.toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit' });
  lignes.push(deuxColonnes(`Ticket ${ticket.numero}`, `${jour} ${heure}`));
  lignes.push(deuxColonnes(`Caisse ${entete.numeroCaisse}`, entete.nomCaissier));
  if (options.nomClient) lignes.push(`Client : ${options.nomClient}`);
  lignes.push(SEPARATEUR);

  for (const ligne of ticket.lignes) {
    if (ligne.annulee) continue;
    const unite = options.unites?.[ligne.articleId] ?? 'UN';
    lignes.push(ligne.designation.slice(0, LARGEUR));
    const quantite = formaterQuantite(ligne.quantiteMilli, unite);
    const detail = `${quantite} x ${formaterDA(ligne.prixUnitaireCentimes, { devise: false })}`;
    lignes.push(deuxColonnes(`  ${detail}`, formaterDA(ligne.totalTtcCentimes, { devise: false })));
    if (ligne.remiseCentimes > 0 || ligne.remisePourcent > 0) {
      lignes.push(
        deuxColonnes(
          `  Remise ${ligne.remisePourcent > 0 ? `${ligne.remisePourcent} %` : ''}`,
          `-${formaterDA(ligne.remiseCentimes, { devise: false })}`,
        ),
      );
    }
    // Le client doit voir ce que la promotion lui a fait gagner.
    for (const avantage of options.avantages ?? []) {
      if (avantage.numeroLigne !== ligne.numeroLigne) continue;
      const gain = avantage.unitesOffertesMilli > 0
        ? `${avantage.unitesOffertesMilli / 1000} offert(s)`
        : `-${formaterDA(avantage.remiseCentimes, { devise: false })}`;
      lignes.push(deuxColonnes(`  * ${avantage.libelle}`, gain));
    }
  }

  lignes.push(SEPARATEUR);
  if (ticket.remisePiedCentimes > 0) {
    lignes.push(deuxColonnes('Remise', `-${formaterDA(ticket.remisePiedCentimes, { devise: false })}`));
  }
  if (ticket.totalTvaCentimes > 0) {
    lignes.push(deuxColonnes('Total HT', formaterDA(ticket.totalHtCentimes, { devise: false })));
    lignes.push(deuxColonnes('TVA', formaterDA(ticket.totalTvaCentimes, { devise: false })));
  }
  if (ticket.timbreCentimes > 0) {
    lignes.push(deuxColonnes('Droit de timbre', formaterDA(ticket.timbreCentimes, { devise: false })));
  }
  lignes.push(deuxColonnes('TOTAL', formaterDA(ticket.totalTtcCentimes)));
  lignes.push('');

  for (const reglement of ticket.reglements) {
    lignes.push(deuxColonnes(libelleMode(reglement.mode), formaterDA(reglement.montantCentimes, { devise: false })));
  }
  if (ticket.renduCentimes > 0) {
    lignes.push(deuxColonnes('Rendu', formaterDA(ticket.renduCentimes, { devise: false })));
  }

  // Fidelite : le solde figure au ticket (M10).
  if ((options.pointsGagnes ?? 0) > 0 || (options.pointsTotal ?? 0) > 0) {
    lignes.push(SEPARATEUR);
    if ((options.pointsGagnes ?? 0) > 0) {
      lignes.push(deuxColonnes('Points gagnes', String(options.pointsGagnes)));
    }
    if ((options.pointsTotal ?? 0) > 0) {
      lignes.push(deuxColonnes('Solde de points', String(options.pointsTotal)));
    }
  }

  lignes.push(SEPARATEUR);
  if (ticket.horsLigne) {
    // Le client doit pouvoir distinguer un ticket etabli pendant une coupure.
    lignes.push(centrer('* Ticket etabli hors ligne *'));
  }
  lignes.push(centrer('Merci de votre visite'));
  lignes.push(centrer('شكرا لزيارتكم'));
  lignes.push('');

  return lignes.join('\n');
}

function libelleMode(mode: string): string {
  switch (mode) {
    case 'ESPECES': return 'Especes';
    case 'CARTE': return 'Carte (TPE)';
    case 'CHEQUE': return 'Cheque';
    case 'CREDIT': return 'A credit';
    case 'BON_ACHAT': return "Bon d'achat";
    case 'VIREMENT': return 'Virement';
    default: return mode;
  }
}

/** Commandes ESC/POS : initialisation, texte, coupe, ouverture du tiroir. */
export function versEscPos(texte: string, options: { ouvrirTiroir?: boolean } = {}): Buffer {
  const ESC = 0x1b;
  const GS = 0x1d;
  const morceaux: number[] = [];

  morceaux.push(ESC, 0x40); // initialiser
  morceaux.push(ESC, 0x74, 0x10); // page de codes Windows-1256 (arabe)

  for (const octet of Buffer.from(texte + '\n\n\n', 'utf8')) morceaux.push(octet);

  morceaux.push(GS, 0x56, 0x42, 0x00); // coupe partielle
  if (options.ouvrirTiroir) {
    morceaux.push(ESC, 0x70, 0x00, 0x19, 0xfa); // impulsion tiroir, broche 2
  }
  return Buffer.from(morceaux);
}
