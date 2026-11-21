import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ouvrirBase } from '../src/principal/base';
import { chercherParCode } from '../src/principal/catalogue';
import { panierVide, ajouterLigne, totauxPanier, encaisser } from '../src/principal/vente';
import { ouvrirSession } from '../src/principal/session';
import { presenterBon, debiterLocalement } from '../src/principal/bons';
import { Synchronisation, clientHttpParDefaut, type ClientHttp } from '../src/principal/synchronisation';
import type Database from 'better-sqlite3';

/**
 * Le scenario redoute des cartes cadeaux.
 *
 * Un bon d'achat est de l'argent au porteur. Deux caisses privees de
 * reseau connaissent chacune le meme solde et peuvent accepter la meme
 * carte : elle est alors depensee deux fois. On ne peut pas l'empecher
 * sans refuser les bons pendant les coupures, ce que le cahier des
 * charges interdit en substance (section 4 : la caisse doit continuer a
 * vendre). Ce que le logiciel doit garantir, c'est que rien ne se perd
 * en silence : les deux ventes tiennent, le solde ne devient jamais
 * negatif, et le manque remonte au gerant au centime.
 */

const BASE_API = process.env.API_BASE ?? 'http://localhost:3000/api/v1';
const ANNEE = new Date().getFullYear();
const CARTE = `CAD-${ANNEE}-000002`;

class ClientDebranchable implements ClientHttp {
  public branche = true;
  constructor(private readonly reel: ClientHttp) {}
  async poster<T>(chemin: string, corps: unknown, jeton: string | null): Promise<T> {
    if (!this.branche) throw new Error('fetch failed: ECONNREFUSED (cable debranche)');
    return this.reel.poster<T>(chemin, corps, jeton);
  }
}

interface Caisse {
  base: Database.Database;
  numeroCaisse: number;
  sync: Synchronisation;
  reseau: ClientDebranchable;
  sessionNumero: string;
}

/**
 * Decalage de la numerotation locale.
 *
 * Les suites de test partagent un seul serveur. Sans ce decalage, les
 * tickets de cette suite s'appelleraient SV-03-000001 comme ceux de la
 * suite de coupure reseau : le serveur les prendrait, a juste titre,
 * pour des renvois deja recus, et la moitie des ventes ne compterait
 * pas. Les vraies caisses n'ont pas ce probleme — chacune a son numero
 * et sa base.
 */
const DECALAGE_NUMEROTATION = 900;

let utilisateurId: string;
let jetonGerant: string;
const caisses: Caisse[] = [];

async function connexionPin(code: string) {
  const r = await fetch(`${BASE_API}/auth/connexion-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, pin: '1234' }),
  });
  if (!r.ok) throw new Error(`connexion refusee pour la caisse ${code}`);
  return r.json();
}

async function monterCaisse(numeroCaisse: number, jeton: string): Promise<Caisse> {
  const base = ouvrirBase(':memory:');
  const reseau = new ClientDebranchable(clientHttpParDefaut(BASE_API));
  const sync = new Synchronisation(
    base, { urlServeur: BASE_API, codeMagasin: 'SV', numeroCaisse }, reseau,
  );
  base.prepare(`INSERT INTO etat_sync (cle, valeur) VALUES ('sync.jeton', ?)`).run(jeton);
  for (const journal of ['TICKET', 'SESSION']) {
    base
      .prepare('INSERT INTO compteur (cle, valeur) VALUES (?, ?)')
      .run(`${journal}.SV.${numeroCaisse}`, DECALAGE_NUMEROTATION);
  }
  await sync.descendre();
  const session = ouvrirSession(base, {
    codeMagasin: 'SV', numeroCaisse, utilisateurId, fondDeCaisseCentimes: 500000,
  });
  return { base, numeroCaisse, sync, reseau, sessionNumero: session.numero };
}

beforeAll(async () => {
  const caissier = await connexionPin('3');
  utilisateurId = caissier.utilisateur.id;

  const gerant = await fetch(`${BASE_API}/auth/connexion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'gerant', motDePasse: 'GestGlobale2026!' }),
  }).then((r) => r.json());
  jetonGerant = gerant.jeton;

  // Deux caisses du meme magasin, chacune avec sa base locale.
  caisses.push(await monterCaisse(3, caissier.jeton));
  caisses.push(await monterCaisse(2, caissier.jeton));
}, 60000);

afterAll(() => { for (const c of caisses) c.base?.close(); });

/** Vend un article pour un montant donne, regle entierement par le bon. */
function vendreAvecLeBon(caisse: Caisse, code: string, quantiteMilli: number) {
  const trouve = chercherParCode(caisse.base, code);
  expect(trouve).not.toBeNull();
  const panier = panierVide();
  ajouterLigne(panier, {
    article: trouve!.article, quantiteMilli, codeScanne: trouve!.codeScanne,
  });
  const totaux = totauxPanier(panier, ['BON_ACHAT']);

  const decision = presenterBon(caisse.base, CARTE, totaux.totalTtcCentimes);
  expect(decision.accepte).toBe(true);

  const resultat = encaisser(
    caisse.base, panier,
    [{
      mode: 'BON_ACHAT',
      montantCentimes: decision.montantUtiliseCentimes,
      reference: CARTE,
    },
    ...(decision.resteAPayerCentimes > 0
      ? [{ mode: 'ESPECES' as const, montantCentimes: decision.resteAPayerCentimes }]
      : [])],
    {
      codeMagasin: 'SV', numeroCaisse: caisse.numeroCaisse,
      sessionNumero: caisse.sessionNumero, utilisateurId, horsLigne: true,
    },
  );
  return { resultat, decision, totaux };
}

describe('Cartes cadeaux pendant une coupure reseau (M10)', () => {
  it('les deux caisses connaissent la carte et son solde', () => {
    for (const caisse of caisses) {
      const d = presenterBon(caisse.base, CARTE, 10000);
      expect(d.accepte).toBe(true);
      expect(d.soldeApresCentimes).toBe(90000);
    }
  });

  it('refuse un code que la caisse n\'a jamais vu, plutot que d\'inventer de l\'argent', () => {
    const d = presenterBon(caisses[0].base, 'CAD-1999-999999', 10000);
    expect(d.accepte).toBe(false);
    expect(d.motif).toBe('INCONNU');
    // Le message doit dire quoi faire : le bon vient peut-etre d'etre emis.
    expect(d.message).toBeTruthy();
  });

  it('accepte la carte hors ligne sur les deux caisses a la fois', () => {
    for (const caisse of caisses) caisse.reseau.branche = false;

    // 1 000 DA sur la carte. Chaque caisse vend une huile a 750 DA et
    // croit, a juste titre au vu de ce qu'elle sait, que la carte couvre.
    const a = vendreAvecLeBon(caisses[0], '6130000000017', 1000);
    const b = vendreAvecLeBon(caisses[1], '6130000000017', 1000);

    expect(a.decision.montantUtiliseCentimes).toBe(a.totaux.totalTtcCentimes);
    expect(b.decision.montantUtiliseCentimes).toBe(b.totaux.totalTtcCentimes);
    const premier = String(DECALAGE_NUMEROTATION + 1).padStart(6, '0');
    expect(a.resultat.ticket.numero).toBe(`SV-03-${premier}`);
    expect(b.resultat.ticket.numero).toBe(`SV-02-${premier}`);
  });

  it('chaque caisse a debite son solde local, sans savoir pour l\'autre', () => {
    for (const caisse of caisses) {
      const d = presenterBon(caisse.base, CARTE, 10000);
      // 1 000 DA - 750 DA = 250 DA restants, selon chaque caisse.
      expect(d.soldeApresCentimes).toBe(15000);
    }
  });

  it('ne descend jamais le solde local sous zero', () => {
    const base = caisses[0].base;
    debiterLocalement(base, CARTE, 999999999);
    const solde = base
      .prepare('SELECT solde_centimes AS s FROM bon_achat WHERE code = ?')
      .get(CARTE) as { s: number };
    expect(solde.s).toBe(0);
  });

  it('remonte les deux ventes au retour du reseau, sans en refuser aucune', async () => {
    for (const caisse of caisses) {
      caisse.reseau.branche = true;
      const cycle = await caisse.sync.cycle();
      expect(cycle.remontee?.ok).toBe(true);
    }

    const bons = await fetch(`${BASE_API}/fidelite/bons?code=${CARTE}`, {
      headers: { Authorization: `Bearer ${jetonGerant}` },
    }).then((r) => r.json());
    expect(bons[0].utilisations).toHaveLength(2);
  }, 60000);

  it('le solde au serveur est a zero, jamais negatif', async () => {
    const bons = await fetch(`${BASE_API}/fidelite/bons?code=${CARTE}`, {
      headers: { Authorization: `Bearer ${jetonGerant}` },
    }).then((r) => r.json());
    expect(Number(bons[0].soldeCentimes)).toBe(0);
  });

  it('signale au gerant, au centime, ce que la carte ne couvrait pas', async () => {
    const decouverts = await fetch(`${BASE_API}/fidelite/bons/decouverts`, {
      headers: { Authorization: `Bearer ${jetonGerant}` },
    }).then((r) => r.json());

    const surCetteCarte = decouverts.filter(
      (d: { bon: { code: string } }) => d.bon.code === CARTE,
    );
    expect(surCetteCarte).toHaveLength(1);

    // Les deux ventes font 2 x 750 DA = 1 500 DA pour une carte de
    // 1 000 DA : il manque exactement 500 DA.
    const manque = surCetteCarte.reduce(
      (t: number, d: { decouvertCentimes: string }) => t + Number(d.decouvertCentimes), 0,
    );
    expect(manque).toBe(50000);

    // Et c'est bien marque comme survenu hors ligne, pour que le gerant
    // sache qu'aucun caissier n'a fauté.
    expect(surCetteCarte[0].horsLigne).toBe(true);
  });
});
