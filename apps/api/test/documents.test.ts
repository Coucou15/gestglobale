import { describe, it, expect } from 'vitest';
import { enToutesLettres, composerDocument, type DocumentImprimable } from '../src/ventes/impression';

/**
 * Le montant en toutes lettres est une mention obligatoire des factures.
 * Les pieges du francais — 70, 80, 90, les pluriels de « cent » et
 * « vingt », le « et un » — sont verifies un par un.
 */
describe('Montant en toutes lettres', () => {
  const cas: Array<[number, string]> = [
    [0, 'zero dinar'],
    [100, 'un dinar'],
    [200, 'deux dinars'],
    [2100, 'vingt-et-un dinars'],
    [7000, 'soixante-dix dinars'],
    [7100, 'soixante-et-onze dinars'],
    [8000, 'quatre-vingts dinars'],
    [8100, 'quatre-vingt-un dinars'],
    [9000, 'quatre-vingt-dix dinars'],
    [7200, 'soixante-douze dinars'],
    [9100, 'quatre-vingt-onze dinars'],
    [9900, 'quatre-vingt-dix-neuf dinars'],
    [6100, 'soixante-et-un dinars'],
    [8000, 'quatre-vingts dinars'],
    [18000, 'cent quatre-vingts dinars'],
    [10000, 'cent dinars'],
    [20000, 'deux cents dinars'],
    [20100, 'deux cent un dinars'],
    [100000, 'mille dinars'],
    [200000, 'deux mille dinars'],
    [100000000, 'un million dinars'],
  ];

  for (const [centimes, attendu] of cas) {
    it(`${(centimes / 100).toLocaleString('fr-FR')} DA`, () => {
      expect(enToutesLettres(centimes)).toBe(attendu);
    });
  }

  it('ajoute les centimes quand il y en a', () => {
    expect(enToutesLettres(123456_78)).toBe(
      'cent vingt-trois mille quatre cent cinquante-six dinars et soixante-dix-huit centimes',
    );
  });

  it('gere un montant negatif, comme sur un avoir', () => {
    expect(enToutesLettres(-250_50)).toBe(
      'moins deux cent cinquante dinars et cinquante centimes',
    );
  });
});

function documentDeTest(surcharge: Partial<DocumentImprimable> = {}): DocumentImprimable {
  return {
    numero: 'FA-2026-000001',
    type: 'FACTURE',
    statut: 'VALIDE',
    brouillon: false,
    dateVente: new Date('2026-11-21T10:00:00Z'),
    dateEcheance: new Date('2026-12-21T00:00:00Z'),
    observation: null,
    mentions: {
      emetteur: {
        raisonSociale: 'Superette Demo', adresse: 'Alger', telephone: '0550000000',
        rc: '16/00-0000000 B 00', nif: '000000000000000', nis: '111111111111111',
        articleImposition: '22222222222',
      },
      destinataire: {
        code: 'C0001', raisonSociale: 'Cafeteria El Bahdja', adresse: 'Tizi Ouzou',
        telephone: '0660000001', rc: '16/00-1111111 B 11', nif: '333333333333333',
        nis: '444444444444444', articleImposition: '55555555555',
      },
      emisLe: '2026-11-21T10:00:00.000Z',
    },
    totalBrutCentimes: 100000,
    totalRemiseCentimes: 5000,
    totalHtCentimes: 95000,
    totalTvaCentimes: 0,
    timbreCentimes: 1000,
    totalTtcCentimes: 96000,
    lignes: [
      {
        numeroLigne: 1, designation: 'Huile de table 5 L', quantiteMilli: 2000,
        prixUnitaireCentimes: 50000, remisePourcent: 5, tauxTva: 0,
        totalHtCentimes: 95000, totalTtcCentimes: 95000,
        article: { reference: 'ART0001', unite: 'UN' },
      },
    ],
    reglements: [{ mode: 'CREDIT', montantCentimes: 96000 }],
    utilisateur: { nom: 'Gerant' },
    documentSource: null,
    ...surcharge,
  };
}

describe('Mise en page du document', () => {
  it('porte les mentions legales de l’emetteur et du client', () => {
    const html = composerDocument(documentDeTest());
    for (const mention of [
      '16/00-0000000 B 00', '000000000000000', '111111111111111', '22222222222',
      '16/00-1111111 B 11', '333333333333333', '444444444444444', '55555555555',
    ]) {
      expect(html).toContain(mention);
    }
  });

  it('affiche le numero, la date et l’echeance', () => {
    const html = composerDocument(documentDeTest());
    expect(html).toContain('FA-2026-000001');
    expect(html).toContain('21/11/2026');
    expect(html).toContain('21/12/2026');
  });

  it('detaille les totaux et le droit de timbre', () => {
    const html = composerDocument(documentDeTest());
    expect(html).toContain('Droit de timbre');
    expect(html).toContain('Net a payer');
    expect(html).toContain('960,00 DA');
  });

  it('porte le montant en toutes lettres', () => {
    expect(composerDocument(documentDeTest())).toContain('neuf cent soixante dinars');
  });

  it('marque visiblement un brouillon', () => {
    expect(composerDocument(documentDeTest({ brouillon: true }))).toContain('BROUILLON');
    expect(composerDocument(documentDeTest())).not.toContain('>BROUILLON<');
  });

  it('marque visiblement un document annule', () => {
    expect(composerDocument(documentDeTest({ statut: 'ANNULE' }))).toContain('ANNULE');
  });

  it('avertit qu’une proforma n’est pas contractuelle', () => {
    const html = composerDocument(documentDeTest({ type: 'PROFORMA' }));
    expect(html).toContain('non contractuel');
    expect(html).toContain('FACTURE PROFORMA');
  });

  it('echappe le HTML present dans les designations', () => {
    const html = composerDocument(
      documentDeTest({
        lignes: [
          {
            numeroLigne: 1, designation: 'Huile <script>alert(1)</script>',
            quantiteMilli: 1000, prixUnitaireCentimes: 100, remisePourcent: 0, tauxTva: 0,
            totalHtCentimes: 100, totalTtcCentimes: 100,
            article: { reference: 'X&Y', unite: 'UN' },
          },
        ],
      }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('X&amp;Y');
  });
});
