import { describe, it, expect } from 'vitest';
import {
  BAREME_PAIE_DEFAUT, calculerBulletin, calculerIrg,
  contratsAAlerter, heuresMensuellesPrevues, heuresSupplementaires,
  type BaremePaie,
} from '../domain/paie';

/** Un bulletin nu, que chaque cas vient modifier. */
const entrees = {
  salaireBaseCentimes: 4000000, // 40 000 DA
  heuresTravaillees: heuresMensuellesPrevues(BAREME_PAIE_DEFAUT),
  joursOuvrables: 22,
  joursAbsenceNonPayee: 0,
  primes: [],
  avancesCentimes: 0,
  ecartsDeCaisseCentimes: 0,
};

describe('Heures supplementaires (M13)', () => {
  it('convertit les semaines en mois sans inventer d\'heures', () => {
    // 40 h par semaine sur 52 semaines, etalees sur 12 mois.
    expect(heuresMensuellesPrevues(BAREME_PAIE_DEFAUT)).toBeCloseTo(173.33, 2);
  });

  it('ne compte rien en dessous de l\'horaire prevu', () => {
    expect(heuresSupplementaires(150, BAREME_PAIE_DEFAUT)).toBe(0);
  });

  it('compte ce qui depasse', () => {
    expect(heuresSupplementaires(183.33, BAREME_PAIE_DEFAUT)).toBeCloseTo(10, 1);
  });
});

describe('Impot sur le revenu (M13)', () => {
  it('n\'impose pas un revenu sous la premiere tranche', () => {
    expect(calculerIrg(1500000, BAREME_PAIE_DEFAUT)).toBe(0);
  });

  it('est progressif : seule la part dans la tranche est imposee', () => {
    // 30 000 DA : 20 000 a 0 %, puis 10 000 a 20 % = 2 000 DA.
    expect(calculerIrg(3000000, BAREME_PAIE_DEFAUT)).toBe(200000);
  });

  it('traverse plusieurs tranches sans imposer deux fois la meme part', () => {
    // 50 000 DA : 0 sur 20 000, 20 % sur 20 000 = 4 000,
    // puis 30 % sur 10 000 = 3 000. Total 7 000 DA.
    expect(calculerIrg(5000000, BAREME_PAIE_DEFAUT)).toBe(700000);
  });

  it('impose la derniere tranche sans plafond', () => {
    // 100 000 DA : 0 + 4 000 + 12 000 + 35 % sur 20 000 = 7 000.
    expect(calculerIrg(10000000, BAREME_PAIE_DEFAUT)).toBe(2300000);
  });

  it('ne rend jamais d\'impot negatif', () => {
    expect(calculerIrg(-500000, BAREME_PAIE_DEFAUT)).toBe(0);
  });
});

describe('Bulletin de paie (M13)', () => {
  it('compose un bulletin simple, dans l\'ordre d\'un bulletin reel', () => {
    const b = calculerBulletin(entrees);
    expect(b.brutCentimes).toBe(4000000);
    // 9 % de cotisations salariales.
    expect(b.cotisationsCentimes).toBe(360000);
    expect(b.baseImposableCentimes).toBe(3640000);
    // 20 000 a 0 %, 16 400 a 20 %.
    expect(b.irgCentimes).toBe(328000);
    expect(b.netAPayerCentimes).toBe(4000000 - 360000 - 328000);
  });

  it('proratise une absence non payee sur les jours ouvrables', () => {
    const b = calculerBulletin({ ...entrees, joursAbsenceNonPayee: 2 });
    // 2 jours sur 22 : 40 000 x 2 / 22 = 3 636,36 DA.
    expect(b.retenueAbsenceCentimes).toBe(363636);
    expect(b.brutCentimes).toBe(4000000 - 363636);
  });

  it('ne retient jamais plus de jours que le mois n\'en compte', () => {
    const b = calculerBulletin({ ...entrees, joursAbsenceNonPayee: 40 });
    expect(b.retenueAbsenceCentimes).toBe(4000000);
    expect(b.brutCentimes).toBe(0);
    expect(b.netAPayerCentimes).toBe(0);
  });

  it('majore les heures supplementaires', () => {
    const b = calculerBulletin({
      ...entrees,
      heuresTravaillees: heuresMensuellesPrevues(BAREME_PAIE_DEFAUT) + 10,
    });
    // Taux horaire 40 000 / 173,33 = 230,77 DA, majore de 50 %.
    expect(b.heuresSupplementaires).toBeCloseTo(10, 1);
    expect(b.heuresSupCentimes).toBe(346154);
  });

  it('exonere les primes de panier et de transport de cotisations', () => {
    const b = calculerBulletin({
      ...entrees,
      primes: [
        { code: 'PANIER', libelle: 'Panier', montantCentimes: 500000 },
        { code: 'RENDEMENT', libelle: 'Rendement', montantCentimes: 300000 },
      ],
    });
    expect(b.primesCentimes).toBe(800000);
    expect(b.primesExonereesCentimes).toBe(500000);
    // Les cotisations ne portent pas sur la prime de panier.
    expect(b.assietteCotisableCentimes).toBe(4000000 + 300000);
    expect(b.cotisationsCentimes).toBe(387000);
    // Mais la prime exoneree est bien versee.
    expect(b.brutCentimes).toBe(4800000);
  });

  it('deduit l\'avance sur salaire du net', () => {
    const b = calculerBulletin({ ...entrees, avancesCentimes: 1000000 });
    const sans = calculerBulletin(entrees);
    expect(b.netAPayerCentimes).toBe(sans.netAPayerCentimes - 1000000);
    expect(b.retenues.some((r) => r.origine === 'AVANCE')).toBe(true);
  });

  it('ne retient pas un ecart de caisse tant que la regle interne ne le prevoit pas', () => {
    const b = calculerBulletin({ ...entrees, ecartsDeCaisseCentimes: 500000 });
    expect(b.retenues.some((r) => r.origine === 'ECART_CAISSE')).toBe(false);
    expect(b.netAPayerCentimes).toBe(calculerBulletin(entrees).netAPayerCentimes);
  });

  it('le retient si le client l\'a decide explicitement', () => {
    const bareme: BaremePaie = { ...BAREME_PAIE_DEFAUT, retenirEcartsDeCaisse: true };
    const b = calculerBulletin({ ...entrees, ecartsDeCaisseCentimes: 500000 }, bareme);
    expect(b.retenues.some((r) => r.origine === 'ECART_CAISSE')).toBe(true);
    expect(b.netAPayerCentimes)
      .toBe(calculerBulletin(entrees, bareme).netAPayerCentimes - 500000);
  });

  it('ne descend jamais sous zero, meme si les retenues depassent le net', () => {
    // Un salaire ne se preleve pas d'avance : le reliquat est reporte.
    const b = calculerBulletin({ ...entrees, avancesCentimes: 99999999 });
    expect(b.netAPayerCentimes).toBe(0);
  });

  it('chiffre le cout employeur, cotisations patronales comprises', () => {
    const b = calculerBulletin(entrees);
    expect(b.cotisationsPatronalesCentimes).toBe(1040000);
    expect(b.coutEmployeurCentimes).toBe(4000000 + 1040000);
  });

  it('suit le bareme qu\'on lui donne, pas celui qu\'il connait', () => {
    // Un bulletin ancien doit pouvoir etre rejoue avec ses taux d'alors.
    const ancien: BaremePaie = {
      ...BAREME_PAIE_DEFAUT,
      cotisationSalarialePourcent: 7,
      tranchesIrg: [{ plafondCentimes: null, tauxPourcent: 10 }],
    };
    const b = calculerBulletin(entrees, ancien);
    expect(b.cotisationsCentimes).toBe(280000);
    expect(b.irgCentimes).toBe(372000);
  });
});

describe('Alerte de fin de contrat (M13)', () => {
  const maintenant = new Date('2026-11-22T12:00:00.000Z');

  it('signale un CDD qui se termine dans moins de trente jours', () => {
    const alertes = contratsAAlerter([
      { type: 'CDD', fin: '2026-12-10T00:00:00.000Z', actif: true },
    ], maintenant);
    expect(alertes).toHaveLength(1);
    expect(alertes[0].joursRestants).toBe(18);
  });

  it('ignore un CDI, qui n\'a pas de terme', () => {
    expect(contratsAAlerter([
      { type: 'CDI', fin: null, actif: true },
    ], maintenant)).toHaveLength(0);
  });

  it('ignore un contrat qui se termine bien plus tard', () => {
    expect(contratsAAlerter([
      { type: 'CDD', fin: '2027-06-01T00:00:00.000Z', actif: true },
    ], maintenant)).toHaveLength(0);
  });

  it('ignore un contrat deja clos', () => {
    expect(contratsAAlerter([
      { type: 'CDD', fin: '2026-12-01T00:00:00.000Z', actif: false },
    ], maintenant)).toHaveLength(0);
  });

  it('signale aussi un contrat deja expire, qu\'on a laisse passer', () => {
    const alertes = contratsAAlerter([
      { type: 'ESSAI', fin: '2026-11-15T00:00:00.000Z', actif: true },
    ], maintenant);
    expect(alertes).toHaveLength(1);
    expect(alertes[0].joursRestants).toBeLessThan(0);
  });

  it('met les plus urgents en tete', () => {
    const alertes = contratsAAlerter([
      { type: 'CDD', fin: '2026-12-15T00:00:00.000Z', actif: true },
      { type: 'ESSAI', fin: '2026-11-25T00:00:00.000Z', actif: true },
    ], maintenant);
    expect(alertes.map((a) => a.type)).toEqual(['ESSAI', 'CDD']);
  });
});
