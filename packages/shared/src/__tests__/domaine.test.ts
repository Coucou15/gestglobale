import { describe, it, expect } from 'vitest';
import {
  versCentimes, versDinars, formaterDA, decomposerRendu, somme,
  normaliserUnite, versMilli, formaterQuantite, quantiteValide,
  cleEan13, ean13Valide, genererEan13, analyserCodeScanne,
  recalculerCump, valeurStock, margeLigne, prixVenteDepuisMarge,
  totauxLigne, totauxDocument, calculerTimbre, TIMBRE_DEFAUT,
  calculerCloture, totalComptage, numeroDocument, analyserNumeroDocument,
  evaluerCredit, etatConnexion, PERMISSIONS_PAR_ROLE, PERMISSIONS,
} from '../index';

describe('Montants en dinar', () => {
  it('convertit sans derive flottante', () => {
    expect(versCentimes('1234,56')).toBe(123456);
    expect(versCentimes(0.1 + 0.2)).toBe(30);
    expect(versDinars(123456)).toBe(1234.56);
  });

  it('formate a la francaise avec separateur de milliers', () => {
    expect(formaterDA(34679100)).toBe('346 791,00 DA');
    expect(formaterDA(-7217100)).toBe('-72 171,00 DA');
  });

  it('additionne 1752 lignes sans perte', () => {
    const lignes = Array.from({ length: 1752 }, () => versCentimes('19,99'));
    expect(somme(lignes)).toBe(1752 * 1999);
  });

  it('decompose le rendu de monnaie', () => {
    // 1 275 DA = 1 billet de 1000 + 1 de 200 + 1 piece de 50 + 1 de 20 + 1 de 5
    const rendu = decomposerRendu(127500, [200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500]);
    expect(somme(rendu.map((r) => r.coupure * r.nombre))).toBe(127500);
  });
});

describe('Unites et quantites', () => {
  it('normalise les unites de l ancien logiciel', () => {
    expect(normaliserUnite('U')).toEqual({ unite: 'UN', facteur: 1, suspecte: false });
    expect(normaliserUnite('K')).toEqual({ unite: 'KG', facteur: 1, suspecte: false });
    expect(normaliserUnite('GR').facteur).toBe(0.001);
  });

  it('signale les valeurs aberrantes de l export', () => {
    for (const aberrante of ['.', '+', '28272']) {
      expect(normaliserUnite(aberrante).suspecte).toBe(true);
    }
  });

  it('refuse une demi-piece mais accepte 0,250 KG', () => {
    expect(quantiteValide(versMilli(0.5), 'UN')).toBe(false);
    expect(quantiteValide(versMilli(0.25), 'KG')).toBe(true);
    expect(formaterQuantite(versMilli(0.25), 'KG')).toBe('0,250');
  });
});

describe('Codes-barres', () => {
  it('calcule et valide la cle EAN-13', () => {
    expect(cleEan13('400638133393')).toBe(1);
    expect(ean13Valide('4006381333931')).toBe(true);
    expect(ean13Valide('4006381333932')).toBe(false);
    expect(ean13Valide(genererEan13('200000000123'))).toBe(true);
  });

  it('extrait le poids d une etiquette balance', () => {
    // 21 + code 00042 + poids 00750 (0,750 kg) + cle
    const code = genererEan13('210004200750');
    const lu = analyserCodeScanne(code);
    expect(lu.codePoids).toBe(true);
    expect(lu.codeRecherche).toBe('00042');
    expect(lu.poidsMilli).toBe(750);
  });

  it('extrait le prix d une etiquette a prix variable', () => {
    const lu = analyserCodeScanne(genererEan13('270004212550'));
    expect(lu.prixCentimes).toBe(12550);
  });

  it('laisse passer un code article normal', () => {
    const lu = analyserCodeScanne('6130999000015');
    expect(lu.codePoids).toBe(false);
    expect(lu.codeRecherche).toBe('6130999000015');
  });
});

describe('CUMP', () => {
  it('pondere correctement deux receptions', () => {
    // 10 unites a 100 DA, puis 10 a 120 DA => 110 DA
    const cump = recalculerCump(
      { stockMilli: versMilli(10), cumpCentimes: 10000 },
      { quantiteMilli: versMilli(10), prixAchatCentimes: 12000 },
    );
    expect(cump).toBe(11000);
  });

  it('repart du prix d achat quand le stock etait negatif', () => {
    // 136 produits de l export ont un stock negatif.
    const cump = recalculerCump(
      { stockMilli: versMilli(-3), cumpCentimes: 9999 },
      { quantiteMilli: versMilli(10), prixAchatCentimes: 12000 },
    );
    expect(cump).toBe(12000);
  });

  it('detecte une vente a perte', () => {
    const m = margeLigne({ quantiteMilli: versMilli(2), prixVenteCentimes: 9000, cumpCentimes: 10000 });
    expect(m.venteAPerte).toBe(true);
    expect(m.margeCentimes).toBe(-2000);
  });

  it('valorise le stock et propose un prix de vente', () => {
    expect(valeurStock(versMilli(12.5), 8000)).toBe(100000);
    expect(prixVenteDepuisMarge(10000, 20)).toBe(12500);
  });
});

describe('Tarification', () => {
  it('calcule une ligne avec remise et TVA', () => {
    const t = totauxLigne({ quantiteMilli: versMilli(3), prixUnitaireCentimes: 10000, remisePourcent: 10, tauxTva: 19 });
    expect(t.brutCentimes).toBe(30000);
    expect(t.remiseCentimes).toBe(3000);
    expect(t.netHtCentimes).toBe(27000);
    expect(t.tvaCentimes).toBe(5130);
    expect(t.netTtcCentimes).toBe(32130);
  });

  it('ventile la TVA par taux et repartit la remise de pied', () => {
    const d = totauxDocument(
      [
        { quantiteMilli: versMilli(1), prixUnitaireCentimes: 10000, tauxTva: 19 },
        { quantiteMilli: versMilli(1), prixUnitaireCentimes: 10000, tauxTva: 0 },
      ],
      { remisePiedPourcent: 10 },
    );
    expect(d.totalHtCentimes).toBe(18000);
    expect(d.ventilationTva).toHaveLength(2);
    expect(d.ventilationTva.find((v) => v.taux === 19)!.tvaCentimes).toBe(1710);
    expect(d.totalTtcCentimes).toBe(19710);
  });

  it('n applique le timbre qu aux modes soumis', () => {
    const p = { ...TIMBRE_DEFAUT, actif: true };
    expect(calculerTimbre(100000, ['CARTE'], p)).toBe(0);
    expect(calculerTimbre(100000, ['ESPECES'], p)).toBe(1000);
    // plancher de 5 DA
    expect(calculerTimbre(10000, ['ESPECES'], p)).toBe(500);
  });
});

describe('Cloture Z', () => {
  it('calcule un ecart et exige une justification', () => {
    const r = calculerCloture({
      fondDeCaisseCentimes: 500000,
      theoriques: [
        { mode: 'ESPECES', montantCentimes: 3467910 },
        { mode: 'CARTE', montantCentimes: 500000 },
      ],
      comptageEspeces: [{ coupureCentimes: 200000, nombre: 19 }, { coupureCentimes: 10000, nombre: 3 }],
      sortiesEspecesCentimes: 100000,
    });
    expect(r.theoriqueEspecesCentimes).toBe(3867910);
    expect(r.compteEspecesCentimes).toBe(3830000);
    expect(r.ecartEspecesCentimes).toBe(-37910);
    expect(r.justificationRequise).toBe(true);
    expect(r.recetteTotaleCentimes).toBe(3967910);
  });

  it('ne demande pas de justification quand le compte tombe juste', () => {
    const r = calculerCloture({
      fondDeCaisseCentimes: 0,
      theoriques: [{ mode: 'ESPECES', montantCentimes: 200000 }],
      comptageEspeces: [{ coupureCentimes: 200000, nombre: 1 }],
    });
    expect(r.ecartEspecesCentimes).toBe(0);
    expect(r.justificationRequise).toBe(false);
  });

  it('ignore les nombres de coupures negatifs', () => {
    expect(totalComptage([{ coupureCentimes: 100000, nombre: -5 }])).toBe(0);
  });
});

describe('Numerotation des documents', () => {
  it('produit un numero unique par magasin et caisse', () => {
    expect(numeroDocument({ codeMagasin: 'SV', numeroCaisse: 3, compteur: 125 })).toBe('SV-03-000125');
  });

  it('relit un numero', () => {
    expect(analyserNumeroDocument('SV-03-000125')).toEqual({ codeMagasin: 'SV', numeroCaisse: 3, compteur: 125 });
    expect(analyserNumeroDocument('n importe quoi')).toBeNull();
  });
});

describe('Credit client', () => {
  const base = { soldeCentimes: 50000, plafondCentimes: 100000, bloqueManuellement: false };

  it('autorise sous le plafond', () => {
    expect(evaluerCredit(base, 30000).autorise).toBe(true);
  });

  it('bloque au-dela du plafond mais autorise le forcage superviseur', () => {
    const d = evaluerCredit(base, 80000);
    expect(d.autorise).toBe(false);
    expect(d.motif).toBe('PLAFOND_DEPASSE');
    expect(d.forcagePossible).toBe(true);
  });

  it('un blocage manuel n est jamais forcable en caisse', () => {
    const d = evaluerCredit({ ...base, bloqueManuellement: true, motifBlocageManuel: 'Litige' }, 100);
    expect(d.forcagePossible).toBe(false);
    expect(d.message).toBe('Litige');
  });

  it('adapte le message hors ligne', () => {
    expect(evaluerCredit(base, 80000, { horsLigne: true }).message).toContain('hors ligne');
  });
});

describe('Voyant de synchronisation', () => {
  const maintenant = new Date('2026-11-20T10:00:00Z');

  it('vert quand tout est remonte', () => {
    const e = etatConnexion({ derniereSyncReussie: new Date('2026-11-20T09:58:00Z'), ticketsEnAttente: 0, maintenant });
    expect(e.couleur).toBe('vert');
  });

  it('orange des qu un ticket attend', () => {
    const e = etatConnexion({ derniereSyncReussie: new Date('2026-11-20T09:58:00Z'), ticketsEnAttente: 4, maintenant });
    expect(e.couleur).toBe('orange');
  });

  it('rouge au-dela de 24 h', () => {
    const e = etatConnexion({ derniereSyncReussie: new Date('2026-11-18T09:00:00Z'), ticketsEnAttente: 120, maintenant });
    expect(e.couleur).toBe('rouge');
  });
});

describe('Matrice des droits', () => {
  it('un caissier ne peut ni annuler un ticket ni voir les marges', () => {
    const caissier = PERMISSIONS_PAR_ROLE.CAISSIER;
    expect(caissier).not.toContain(PERMISSIONS.VENTE_ANNULER_TICKET);
    expect(caissier).not.toContain(PERMISSIONS.ARTICLE_VOIR_ACHAT_MARGE);
    expect(caissier).not.toContain(PERMISSIONS.ARTICLE_MODIFIER_PRIX_VENTE);
    expect(caissier).toContain(PERMISSIONS.VENTE_ENCAISSER);
  });

  it('seul le gerant gere les utilisateurs', () => {
    for (const role of ['CAISSIER', 'CHEF_DE_CAISSE', 'MAGASINIER', 'ACHETEUR', 'COMPTABLE'] as const) {
      expect(PERMISSIONS_PAR_ROLE[role]).not.toContain(PERMISSIONS.UTILISATEUR_GERER);
    }
    expect(PERMISSIONS_PAR_ROLE.GERANT).toContain(PERMISSIONS.UTILISATEUR_GERER);
  });

  it('caissier et chef de caisse n ont pas l acces Internet', () => {
    expect(PERMISSIONS_PAR_ROLE.CAISSIER).not.toContain(PERMISSIONS.ACCES_INTERNET);
    expect(PERMISSIONS_PAR_ROLE.CHEF_DE_CAISSE).not.toContain(PERMISSIONS.ACCES_INTERNET);
    expect(PERMISSIONS_PAR_ROLE.COMPTABLE).toContain(PERMISSIONS.ACCES_INTERNET);
  });
});
