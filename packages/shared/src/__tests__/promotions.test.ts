import { describe, it, expect } from 'vitest';
import {
  promotionEnVigueur, avantagesDeLaLigne, pointsGagnes, valeurDesPoints,
  BAREME_FIDELITE_DEFAUT, versMilli,
  type Promotion, type LignePromotionnable,
} from '../index';

const promotion = (surcharge: Partial<Promotion>): Promotion => ({
  id: 'p1', libelle: 'Promo', type: 'REMISE_FAMILLE',
  debut: '2026-11-01T00:00:00.000Z', fin: '2026-12-31T23:59:59.000Z',
  articleId: null, familleId: null, valeurCentimes: null, remisePourcent: null,
  quantiteDeclenchement: null, quantiteOfferte: null,
  heureDebut: null, heureFin: null, cumulable: false,
  ...surcharge,
});

const ligne = (surcharge: Partial<LignePromotionnable> = {}): LignePromotionnable => ({
  articleId: 'a1', familleId: 'f1', quantiteMilli: versMilli(1),
  prixUnitaireCentimes: 10000,
  ...surcharge,
});

const pendant = new Date('2026-11-21T12:00:00.000Z');

describe('Periode de validite', () => {
  it('ignore une promotion pas encore commencee', () => {
    expect(promotionEnVigueur(
      promotion({ debut: '2026-12-01T00:00:00.000Z' }), pendant)).toBe(false);
  });

  it('ignore une promotion terminee', () => {
    expect(promotionEnVigueur(
      promotion({ fin: '2026-11-01T00:00:00.000Z' }), pendant)).toBe(false);
  });

  it('retient une promotion en cours', () => {
    expect(promotionEnVigueur(promotion({}), pendant)).toBe(true);
  });

  it('ignore une promotion aux dates illisibles', () => {
    expect(promotionEnVigueur(promotion({ debut: 'n importe quoi' }), pendant)).toBe(false);
  });
});

describe('Happy hour', () => {
  const happy = (debut: string, fin: string) =>
    promotion({ type: 'HAPPY_HOUR', remisePourcent: 20, heureDebut: debut, heureFin: fin });

  it('s applique dans la plage', () => {
    const a = new Date('2026-11-21T19:00:00');
    expect(promotionEnVigueur(happy('18:00', '20:00'), a)).toBe(true);
  });

  it('ne s applique pas en dehors', () => {
    const a = new Date('2026-11-21T16:00:00');
    expect(promotionEnVigueur(happy('18:00', '20:00'), a)).toBe(false);
  });

  it('traverse minuit', () => {
    // 22h a 2h du matin : les deux cotes de minuit comptent.
    expect(promotionEnVigueur(happy('22:00', '02:00'), new Date('2026-11-21T23:30:00'))).toBe(true);
    expect(promotionEnVigueur(happy('22:00', '02:00'), new Date('2026-11-21T01:00:00'))).toBe(true);
    expect(promotionEnVigueur(happy('22:00', '02:00'), new Date('2026-11-21T12:00:00'))).toBe(false);
  });

  it('est ignoree si la plage est illisible', () => {
    expect(promotionEnVigueur(happy('', '20:00'), new Date('2026-11-21T19:00:00'))).toBe(false);
  });
});

describe('Prix barre', () => {
  it('remplace le prix et calcule la remise', () => {
    const [avantage] = avantagesDeLaLigne(
      ligne({ quantiteMilli: versMilli(3) }),
      [promotion({ type: 'PRIX_BARRE', valeurCentimes: 8000, articleId: 'a1' })],
      pendant,
    );
    expect(avantage.prixUnitaireCentimes).toBe(8000);
    expect(avantage.remiseCentimes).toBe(6000);
  });

  it('refuse un prix barre plus cher que le prix courant', () => {
    expect(avantagesDeLaLigne(
      ligne(), [promotion({ type: 'PRIX_BARRE', valeurCentimes: 12000 })], pendant,
    )).toHaveLength(0);
  });
});

describe('X achetes, Y offerts', () => {
  const trois_pour_deux = promotion({
    type: 'X_POUR_Y', quantiteDeclenchement: 2, quantiteOfferte: 1, articleId: 'a1',
  });

  it('n offre rien sous le seuil', () => {
    expect(avantagesDeLaLigne(
      ligne({ quantiteMilli: versMilli(2) }), [trois_pour_deux], pendant)).toHaveLength(0);
  });

  it('offre une unite au troisieme article', () => {
    const [a] = avantagesDeLaLigne(
      ligne({ quantiteMilli: versMilli(3) }), [trois_pour_deux], pendant);
    expect(a.unitesOffertesMilli).toBe(versMilli(1));
    expect(a.remiseCentimes).toBe(10000);
  });

  it('compte les lots entiers, pas les restes', () => {
    // 7 unites = 2 lots de 3, plus 1 unite payante.
    const [a] = avantagesDeLaLigne(
      ligne({ quantiteMilli: versMilli(7) }), [trois_pour_deux], pendant);
    expect(a.unitesOffertesMilli).toBe(versMilli(2));
    expect(a.remiseCentimes).toBe(20000);
  });

  it('ignore une promotion mal renseignee', () => {
    expect(avantagesDeLaLigne(
      ligne({ quantiteMilli: versMilli(10) }),
      [promotion({ type: 'X_POUR_Y', quantiteDeclenchement: 0, quantiteOfferte: 1 })],
      pendant,
    )).toHaveLength(0);
  });
});

describe('Remise par famille', () => {
  it('s applique aux articles de la famille visee', () => {
    const [a] = avantagesDeLaLigne(
      ligne({ quantiteMilli: versMilli(2) }),
      [promotion({ type: 'REMISE_FAMILLE', remisePourcent: 10, familleId: 'f1' })],
      pendant,
    );
    expect(a.remiseCentimes).toBe(2000);
  });

  it('ne touche pas les autres familles', () => {
    expect(avantagesDeLaLigne(
      ligne({ familleId: 'f2' }),
      [promotion({ type: 'REMISE_FAMILLE', remisePourcent: 10, familleId: 'f1' })],
      pendant,
    )).toHaveLength(0);
  });
});

describe('Concurrence entre promotions', () => {
  it('retient la plus avantageuse quand elles ne se cumulent pas', () => {
    const avantages = avantagesDeLaLigne(
      ligne({ quantiteMilli: versMilli(1) }),
      [
        promotion({ id: 'faible', type: 'REMISE_FAMILLE', remisePourcent: 5, familleId: 'f1' }),
        promotion({ id: 'forte', type: 'PRIX_BARRE', valeurCentimes: 7000, articleId: 'a1' }),
      ],
      pendant,
    );
    expect(avantages).toHaveLength(1);
    expect(avantages[0].promotionId).toBe('forte');
    expect(avantages[0].remiseCentimes).toBe(3000);
  });

  it('ajoute une promotion cumulable par-dessus', () => {
    const avantages = avantagesDeLaLigne(
      ligne({ quantiteMilli: versMilli(1) }),
      [
        promotion({ id: 'exclusive', type: 'REMISE_FAMILLE', remisePourcent: 10, familleId: 'f1' }),
        promotion({
          id: 'bonus', type: 'HAPPY_HOUR', remisePourcent: 5, cumulable: true,
          heureDebut: '00:00', heureFin: '23:59',
        }),
      ],
      pendant,
    );
    expect(avantages).toHaveLength(2);
    expect(avantages.reduce((t, a) => t + a.remiseCentimes, 0)).toBe(1500);
  });

  it('ne rend jamais une ligne negative', () => {
    const avantages = avantagesDeLaLigne(
      ligne({ quantiteMilli: versMilli(1) }),
      [
        promotion({ id: 'a', type: 'REMISE_FAMILLE', remisePourcent: 100, familleId: 'f1' }),
        promotion({
          id: 'b', type: 'HAPPY_HOUR', remisePourcent: 50, cumulable: true,
          heureDebut: '00:00', heureFin: '23:59',
        }),
      ],
      pendant,
    );
    const total = avantages.reduce((t, a) => t + a.remiseCentimes, 0);
    expect(total).toBe(10000);
  });

  it('donne le meme resultat quel que soit l ordre de lecture', () => {
    const liste = [
      promotion({ id: 'x', type: 'REMISE_FAMILLE', remisePourcent: 10, familleId: 'f1' }),
      promotion({ id: 'y', type: 'PRIX_BARRE', valeurCentimes: 9000, articleId: 'a1' }),
    ];
    const a = avantagesDeLaLigne(ligne(), liste, pendant);
    const b = avantagesDeLaLigne(ligne(), [...liste].reverse(), pendant);
    expect(a[0].remiseCentimes).toBe(b[0].remiseCentimes);
  });
});

describe('Fidelite', () => {
  const bareme = { ...BAREME_FIDELITE_DEFAUT, actif: true };

  it('ne donne rien quand le programme est inactif', () => {
    expect(pointsGagnes(100000)).toBe(0);
  });

  it('donne un point par tranche de 100 DA depenses', () => {
    expect(pointsGagnes(100_00, bareme)).toBe(1);      // 100 DA
    expect(pointsGagnes(1000_00, bareme)).toBe(10);    // 1 000 DA
    expect(pointsGagnes(3450_00, bareme)).toBe(34);    // 3 450 DA, la tranche entamee ne compte pas
    expect(pointsGagnes(99_00, bareme)).toBe(0);       // 99 DA
  });

  it('refuse d utiliser des points sous le minimum', () => {
    expect(valeurDesPoints(49, bareme)).toBe(0);
    expect(valeurDesPoints(50, bareme)).toBe(5000);
  });
});
