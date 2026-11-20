/**
 * Deux caisses qui remontent en meme temps.
 *
 * Chacune vend les memes articles, mais dans un ordre de lignes inverse.
 * Si le serveur verrouille les lignes de stock dans l'ordre d'apparition
 * sur le ticket, les deux transactions s'attendent mutuellement et
 * PostgreSQL en abat une : le ticket est refuse alors que rien ne le
 * justifie.
 */
import { createRequire } from 'node:module';

const requis = createRequire(import.meta.url);
const { ouvrirBase } = requis('../dist/principal/base.js');
const { chercherParCode } = requis('../dist/principal/catalogue.js');
const { panierVide, ajouterLigne, encaisser, totauxPanier } = requis('../dist/principal/vente.js');
const { ouvrirSession } = requis('../dist/principal/session.js');
const { Synchronisation, clientHttpParDefaut } = requis('../dist/principal/synchronisation.js');

const BASE_API = process.env.API_BASE ?? 'http://localhost:3000/api/v1';
const NB_TICKETS = 60;

async function main() {
  const caissier = await fetch(`${BASE_API}/auth/connexion-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: '3', pin: '1234' }),
  }).then((r) => r.json());

  const caisses = [];
  for (const numero of [2, 3]) {
    const base = ouvrirBase(':memory:');
    base.prepare(`INSERT INTO etat_sync (cle, valeur) VALUES ('sync.jeton', ?)`).run(caissier.jeton);
    const sync = new Synchronisation(
      base,
      { urlServeur: BASE_API, codeMagasin: 'SV', numeroCaisse: numero },
      clientHttpParDefaut(BASE_API, 120000),
    );
    // Un catalogue reduit suffit : on veut la collision, pas le volume.
    await sync.descendre();
    caisses.push({ numero, base, sync });
  }

  // On prend dix articles communs aux deux caisses.
  const codes = caisses[0].base
    .prepare(`SELECT cb.code FROM code_barre cb
                JOIN article a ON a.id = cb.article_id
               WHERE a.vente_autorisee = 1 LIMIT 10`)
    .all().map((l) => l.code);

  if (codes.length < 4) throw new Error('Pas assez d’articles pour le test');

  const sessions = caisses.map((c) =>
    ouvrirSession(c.base, {
      codeMagasin: 'SV', numeroCaisse: c.numero,
      fondDeCaisseCentimes: 0, utilisateurId: caissier.utilisateur.id,
    }).numero,
  );

  for (let i = 0; i < NB_TICKETS; i++) {
    for (let k = 0; k < caisses.length; k++) {
      const caisse = caisses[k];
      // Caisse 2 scanne dans l'ordre, caisse 3 dans l'ordre inverse :
      // c'est la situation qui provoque l'interblocage.
      const ordre = k === 0 ? codes : [...codes].reverse();
      const panier = panierVide();
      for (const code of ordre) {
        const trouve = chercherParCode(caisse.base, code);
        if (!trouve || trouve.prixUnitaireCentimes <= 0) continue;
        ajouterLigne(panier, {
          article: trouve.article,
          quantiteMilli: trouve.quantiteMilli,
          prixUnitaireCentimes: trouve.prixUnitaireCentimes,
          codeScanne: trouve.codeScanne,
        });
      }
      if (panier.lignes.length === 0) continue;
      const totaux = totauxPanier(panier, ['ESPECES']);
      encaisser(caisse.base, panier, [{ mode: 'ESPECES', montantCentimes: totaux.totalTtcCentimes }], {
        codeMagasin: 'SV', numeroCaisse: caisse.numero,
        sessionNumero: sessions[k], utilisateurId: caissier.utilisateur.id, horsLigne: true,
      });
    }
  }

  console.log(`${NB_TICKETS} tickets par caisse, ${codes.length} lignes chacun, ordres inverses.`);
  console.log('Remontee simultanee des deux caisses...\n');

  const resultats = await Promise.all(
    caisses.map(async (caisse) => {
      let acceptes = 0;
      let refuses = 0;
      const erreurs = [];
      for (let tour = 0; tour < 40 && caisse.sync.nombreEnAttente() > 0; tour++) {
        try {
          const r = await caisse.sync.remonter(20);
          acceptes += r.acceptes + r.dejaRecus;
          refuses += r.refuses;
        } catch (e) {
          erreurs.push(String(e));
        }
      }
      const bloques = caisse.sync.elementsBloques(1);
      return { numero: caisse.numero, acceptes, refuses, erreurs, bloques };
    }),
  );

  let probleme = false;
  for (const r of resultats) {
    console.log(`  Caisse ${r.numero} : ${r.acceptes} acquitte(s), ${r.refuses} refuse(s)`);
    if (r.refuses > 0) {
      probleme = true;
      for (const b of r.bloques.slice(0, 3)) {
        console.log(`    ${b.reference} : ${b.derniere_erreur}`);
      }
    }
    for (const e of r.erreurs.slice(0, 2)) console.log(`    erreur reseau : ${e}`);
  }

  const restants = caisses.reduce((t, c) => t + c.sync.nombreEnAttente(), 0);
  console.log(`\n  ${restants} element(s) encore en file`);

  for (const c of caisses) c.base.close();
  if (probleme || restants > 0) {
    console.log('\nECHEC : des tickets deja encaisses ont ete refuses.');
    process.exit(1);
  }
  console.log('\nOK : aucun refus, aucun interblocage.');
}

main().catch((e) => { console.error(e); process.exit(1); });
