import { formaterDA, formaterQuantite, type UniteMesure } from '@gestglobale/shared';
import type { MentionsLegales } from './documents.service';

/**
 * Mise en page A4 d'un document de vente.
 *
 * Rendue en HTML plutot qu'en PDF : le navigateur du back-office imprime
 * ou enregistre en PDF sans qu'aucun moteur supplementaire soit installe
 * sur le serveur Windows du client. Une generation PDF cote serveur
 * restera a ajouter le jour ou les documents devront partir par courriel
 * sans intervention humaine.
 *
 * Les mentions legales proviennent du document lui-meme, figees a son
 * emission, et non des fiches actuelles : une facture ne change pas parce
 * que le client a demenage.
 */

const LIBELLES: Record<string, string> = {
  FACTURE: 'Facture',
  BON_LIVRAISON: 'Bon de livraison',
  PROFORMA: 'Facture proforma',
  AVOIR: 'Avoir',
  RETOUR: 'Retour client',
  TICKET: 'Ticket de caisse',
};

export interface DocumentImprimable {
  numero: string;
  type: string;
  statut: string;
  brouillon: boolean;
  dateVente: Date;
  dateEcheance: Date | null;
  observation: string | null;
  mentions: unknown;
  totalBrutCentimes: number;
  totalRemiseCentimes: number;
  totalHtCentimes: number;
  totalTvaCentimes: number;
  timbreCentimes: number;
  totalTtcCentimes: number;
  lignes: Array<{
    numeroLigne: number;
    designation: string;
    quantiteMilli: number;
    prixUnitaireCentimes: number;
    remisePourcent: number;
    tauxTva: number;
    totalHtCentimes: number;
    totalTtcCentimes: number;
    article: { reference: string; unite: string };
  }>;
  reglements: Array<{ mode: string; montantCentimes: number }>;
  utilisateur: { nom: string };
  documentSource: { numero: string; type: string } | null;
}

function echapper(valeur: string | null | undefined): string {
  return (valeur ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function date(valeur: Date | null): string {
  if (!valeur) return '';
  return new Intl.DateTimeFormat('fr-DZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(valeur);
}

/** Montant en toutes lettres, exige sur les factures algeriennes. */
export function enToutesLettres(centimes: number): string {
  const unites = ['zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit',
    'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
  const dizaines = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante',
    'soixante', 'quatre-vingt', 'quatre-vingt'];

  const souscent = (n: number): string => {
    if (n < 17) return unites[n];
    if (n < 20) return `dix-${unites[n - 10]}`;
    const d = Math.floor(n / 10);
    const u = n % 10;
    // 70 a 79 se disent « soixante-dix » a « soixante-dix-neuf », avec un
    // « et » pour 71 seulement ; 90 a 99 n'en prennent jamais.
    if (d === 7) {
      const reste = n - 60;
      return reste === 11 ? 'soixante-et-onze' : `soixante-${souscent(reste)}`;
    }
    if (d === 9) {
      return `quatre-vingt-${souscent(n - 80)}`;
    }
    if (u === 0) return dizaines[d] + (d === 8 ? 's' : '');
    if (u === 1 && d !== 8) return `${dizaines[d]}-et-un`;
    return `${dizaines[d]}-${unites[u]}`;
  };

  const sousmille = (n: number): string => {
    if (n < 100) return souscent(n);
    const centaines = Math.floor(n / 100);
    const reste = n % 100;
    const tete = centaines === 1 ? 'cent' : `${unites[centaines]} cent${reste === 0 ? 's' : ''}`;
    return reste === 0 ? tete : `${tete} ${souscent(reste)}`;
  };

  const groupes = (n: number): string => {
    if (n === 0) return 'zero';
    if (n < 1000) return sousmille(n);
    if (n < 1_000_000) {
      const milliers = Math.floor(n / 1000);
      const reste = n % 1000;
      const tete = milliers === 1 ? 'mille' : `${sousmille(milliers)} mille`;
      return reste === 0 ? tete : `${tete} ${sousmille(reste)}`;
    }
    const millions = Math.floor(n / 1_000_000);
    const reste = n % 1_000_000;
    const tete = millions === 1 ? 'un million' : `${sousmille(millions)} millions`;
    return reste === 0 ? tete : `${tete} ${groupes(reste)}`;
  };

  const negatif = centimes < 0;
  const absolu = Math.abs(Math.round(centimes));
  const dinars = Math.floor(absolu / 100);
  const cents = absolu % 100;

  let texte = `${groupes(dinars)} dinar${dinars > 1 ? 's' : ''}`;
  if (cents > 0) texte += ` et ${groupes(cents)} centime${cents > 1 ? 's' : ''}`;
  return (negatif ? 'moins ' : '') + texte;
}

export function composerDocument(document: DocumentImprimable): string {
  const mentions = (document.mentions ?? null) as MentionsLegales | null;
  const emetteur = mentions?.emetteur;
  const destinataire = mentions?.destinataire;
  const libelle = LIBELLES[document.type] ?? document.type;
  const annule = document.statut === 'ANNULE';

  const lignes = document.lignes
    .map(
      (l) => `
      <tr>
        <td class="num">${l.numeroLigne}</td>
        <td class="ref">${echapper(l.article.reference)}</td>
        <td>${echapper(l.designation)}</td>
        <td class="n">${formaterQuantite(l.quantiteMilli, l.article.unite as UniteMesure)}</td>
        <td class="u">${echapper(l.article.unite)}</td>
        <td class="n">${formaterDA(l.prixUnitaireCentimes, { devise: false })}</td>
        <td class="n">${l.remisePourcent > 0 ? `${l.remisePourcent} %` : '—'}</td>
        <td class="n">${l.tauxTva > 0 ? `${l.tauxTva} %` : '—'}</td>
        <td class="n">${formaterDA(l.totalHtCentimes, { devise: false })}</td>
      </tr>`,
    )
    .join('');

  const identite = (
    titre: string,
    p: {
      raisonSociale: string; adresse: string | null; telephone: string | null;
      rc: string | null; nif: string | null; nis: string | null; articleImposition: string | null;
    } | null | undefined,
  ) => {
    if (!p) {
      return `<div class="partie"><h2>${titre}</h2><p class="vide">Client de passage</p></div>`;
    }
    const ligne = (etiquette: string, valeur: string | null) =>
      valeur ? `<div><span>${etiquette}</span> ${echapper(valeur)}</div>` : '';
    return `
      <div class="partie">
        <h2>${titre}</h2>
        <div class="nom">${echapper(p.raisonSociale)}</div>
        ${p.adresse ? `<div class="adresse">${echapper(p.adresse)}</div>` : ''}
        ${ligne('Tel.', p.telephone)}
        ${ligne('RC', p.rc)}
        ${ligne('NIF', p.nif)}
        ${ligne('NIS', p.nis)}
        ${ligne('Art. imp.', p.articleImposition)}
      </div>`;
  };

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${echapper(libelle)} ${echapper(document.numero)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Helvetica Neue", Arial, sans-serif; font-size: 11px; color: #111;
    margin: 0; background: #f3f4f6;
  }
  .feuille {
    width: 210mm; min-height: 297mm; margin: 12px auto; padding: 14mm 12mm;
    background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.15);
  }
  @media print {
    body { background: #fff; }
    .feuille { margin: 0; width: auto; min-height: 0; padding: 0; box-shadow: none; }
    .outils { display: none; }
  }
  .outils { width: 210mm; margin: 12px auto 0; display: flex; gap: 8px; }
  .outils button {
    font: inherit; padding: 8px 16px; border: 1px solid #c7ccd4; border-radius: 6px;
    background: #fff; cursor: pointer;
  }
  .brouillon {
    position: fixed; top: 45%; left: 0; right: 0; text-align: center;
    font-size: 72px; color: rgba(200,0,0,.12); transform: rotate(-18deg);
    letter-spacing: 8px; pointer-events: none; font-weight: 700;
  }
  header { display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #111; padding-bottom: 10px; }
  header .titre { text-align: right; }
  header h1 { margin: 0; font-size: 22px; letter-spacing: .5px; }
  header .numero { font-size: 15px; font-weight: 700; margin-top: 4px; }
  header .dates { color: #555; margin-top: 4px; }
  .parties { display: flex; gap: 14px; margin: 14px 0; }
  .partie { flex: 1; border: 1px solid #d5d9e0; border-radius: 4px; padding: 9px 11px; }
  .partie h2 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase;
    letter-spacing: 1px; color: #666; }
  .partie .nom { font-weight: 700; font-size: 13px; }
  .partie .adresse { color: #444; margin-bottom: 3px; }
  .partie div span { display: inline-block; min-width: 56px; color: #666; }
  .partie .vide { color: #888; font-style: italic; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  thead th { background: #eef1f5; border-bottom: 1px solid #c7ccd4; padding: 6px 5px;
    text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
  tbody td { padding: 5px; border-bottom: 1px solid #e6e9ee; vertical-align: top; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.num, td.ref, td.u { color: #555; white-space: nowrap; }
  .bas { display: flex; gap: 14px; margin-top: 14px; align-items: flex-start; }
  .lettres { flex: 1; border: 1px solid #d5d9e0; border-radius: 4px; padding: 9px 11px; }
  .lettres h3 { margin: 0 0 4px; font-size: 10px; text-transform: uppercase; color: #666; }
  .lettres p { margin: 0; font-style: italic; }
  .totaux { width: 74mm; }
  .totaux div { display: flex; justify-content: space-between; padding: 4px 0;
    border-bottom: 1px solid #e6e9ee; }
  .totaux div.net { border-top: 2px solid #111; border-bottom: none;
    font-size: 15px; font-weight: 700; padding-top: 7px; margin-top: 3px; }
  footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #d5d9e0;
    color: #666; font-size: 10px; display: flex; justify-content: space-between; }
  .signature { margin-top: 24px; display: flex; justify-content: flex-end; }
  .signature div { width: 64mm; border-top: 1px solid #888; padding-top: 5px;
    text-align: center; color: #555; }
  .observation { margin-top: 10px; color: #444; }
</style>
</head>
<body>
  <div class="outils">
    <button onclick="window.print()">Imprimer ou enregistrer en PDF</button>
  </div>
  <div class="feuille">
    ${document.brouillon ? '<div class="brouillon">BROUILLON</div>' : ''}
    ${annule ? '<div class="brouillon">ANNULE</div>' : ''}

    <header>
      <div>
        <div style="font-size:16px;font-weight:700">${echapper(emetteur?.raisonSociale ?? '')}</div>
        ${emetteur?.adresse ? `<div>${echapper(emetteur.adresse)}</div>` : ''}
        ${emetteur?.telephone ? `<div>Tel. ${echapper(emetteur.telephone)}</div>` : ''}
        <div style="margin-top:5px;color:#555">
          ${emetteur?.rc ? `RC ${echapper(emetteur.rc)} &nbsp;` : ''}
          ${emetteur?.nif ? `NIF ${echapper(emetteur.nif)} &nbsp;` : ''}
          ${emetteur?.nis ? `NIS ${echapper(emetteur.nis)} &nbsp;` : ''}
          ${emetteur?.articleImposition ? `Art. imp. ${echapper(emetteur.articleImposition)}` : ''}
        </div>
      </div>
      <div class="titre">
        <h1>${echapper(libelle.toUpperCase())}</h1>
        <div class="numero">${echapper(document.numero)}</div>
        <div class="dates">
          Le ${date(document.dateVente)}
          ${document.dateEcheance ? `<br>Echeance : ${date(document.dateEcheance)}` : ''}
          ${document.documentSource
            ? `<br>D'apres ${echapper(document.documentSource.numero)}`
            : ''}
        </div>
      </div>
    </header>

    <div class="parties">
      ${identite('Emetteur', emetteur)}
      ${identite('Client', destinataire)}
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:7mm">N°</th>
          <th style="width:26mm">Reference</th>
          <th>Designation</th>
          <th class="n" style="width:18mm">Quantite</th>
          <th style="width:11mm">Unite</th>
          <th class="n" style="width:22mm">P.U. HT</th>
          <th class="n" style="width:14mm">Remise</th>
          <th class="n" style="width:12mm">TVA</th>
          <th class="n" style="width:26mm">Total HT</th>
        </tr>
      </thead>
      <tbody>${lignes}</tbody>
    </table>

    <div class="bas">
      <div class="lettres">
        <h3>Arrete le present document a la somme de</h3>
        <p>${echapper(enToutesLettres(document.totalTtcCentimes))}.</p>
        ${document.reglements.length > 0
          ? `<div style="margin-top:7px;color:#555">Reglement : ${document.reglements
              .map((r) => `${r.mode.toLowerCase().replace(/_/g, ' ')} ${formaterDA(r.montantCentimes)}`)
              .join(', ')}</div>`
          : ''}
        ${document.observation ? `<div class="observation">${echapper(document.observation)}</div>` : ''}
      </div>
      <div class="totaux">
        <div><span>Total brut</span><span>${formaterDA(document.totalBrutCentimes)}</span></div>
        ${document.totalRemiseCentimes > 0
          ? `<div><span>Remise</span><span>-${formaterDA(document.totalRemiseCentimes)}</span></div>`
          : ''}
        <div><span>Total HT</span><span>${formaterDA(document.totalHtCentimes)}</span></div>
        <div><span>TVA</span><span>${formaterDA(document.totalTvaCentimes)}</span></div>
        ${document.timbreCentimes > 0
          ? `<div><span>Droit de timbre</span><span>${formaterDA(document.timbreCentimes)}</span></div>`
          : ''}
        <div class="net"><span>Net a payer</span><span>${formaterDA(document.totalTtcCentimes)}</span></div>
      </div>
    </div>

    ${document.type === 'PROFORMA'
      ? '<p class="observation"><strong>Document non contractuel</strong> — ' +
        'cette proforma ne vaut ni facture ni livraison.</p>'
      : ''}

    <div class="signature"><div>Cachet et signature</div></div>

    <footer>
      <span>Etabli par ${echapper(document.utilisateur.nom)}</span>
      <span>GestGlobale</span>
    </footer>
  </div>
</body>
</html>`;
}
