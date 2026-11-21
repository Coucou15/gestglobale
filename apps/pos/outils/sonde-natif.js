/**
 * Verifie qu'Electron charge reellement les modules natifs de la caisse.
 *
 * Un module natif est compile pour une version precise de l'interface
 * binaire de Node. Electron embarque sa propre version : un module
 * compile pour Node ne s'y charge pas, et la caisse s'arrete au
 * demarrage. Ce controle doit passer avant tout empaquetage.
 *
 *   xvfb-run -a npx electron --no-sandbox outils/sonde-natif.js
 */
const { app } = require('electron');

app.on('ready', () => {
  const resultat = {
    electron: process.versions.electron,
    node: process.versions.node,
    abi: process.versions.modules,
  };

  try {
    const Database = require('better-sqlite3');
    const base = new Database(':memory:');
    base.exec('CREATE TABLE sonde (valeur INTEGER)');
    base.prepare('INSERT INTO sonde VALUES (?)').run(42);
    resultat.sqlite = base.prepare('SELECT valeur FROM sonde').get().valeur === 42
      ? 'ok' : 'valeur inattendue';
    base.close();
  } catch (erreur) {
    resultat.sqlite = 'ECHEC : ' + String(erreur.message).split('\n')[0];
  }

  try {
    const argon2 = require('argon2');
    resultat.argon2 = typeof argon2.verify === 'function' ? 'ok' : 'interface inattendue';
  } catch (erreur) {
    resultat.argon2 = 'ECHEC : ' + String(erreur.message).split('\n')[0];
  }

  console.log('SONDE ' + JSON.stringify(resultat));
  app.exit(resultat.sqlite === 'ok' && resultat.argon2 === 'ok' ? 0 : 1);
});
