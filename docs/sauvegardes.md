# Sauvegardes et restauration

Le cahier des charges demande une sauvegarde automatique chaque nuit sur
disque local, une copie chiffree hors site, trente jours de retention,
un test de restauration mensuel, et une **restauration complete en moins
d'une heure**.

Ce dernier point n'est pas une promesse : il est joue.

```bash
AVEC_VOLUME=1 bash scripts/eprouver-la-restauration.sh
```

Le script remplit la base au volume reel du client, la sauvegarde, **la
detruit**, la restaure, puis compare. Au dernier passage : 30 015
articles et 7 718 tiers restaures en **1,4 seconde**, chiffres
identiques au centime et chaine d'empreintes du journal d'audit intacte.

---

## Chaque nuit

```bash
node apps/api/outils/sauvegarde.mjs
```

Sous Windows Server, par le Planificateur de taches, chaque nuit a 2 h.

L'outil ecrit un fichier chiffre dans le dossier local, en depose une
copie hors site si un second dossier est configure, puis efface les
sauvegardes passees la retention.

| Reglage | Role | Defaut |
|---|---|---|
| `DATABASE_URL` | la base a sauvegarder | lu dans `apps/api/.env` |
| `SAUVEGARDE_CLE` | **phrase secrete de chiffrement** | aucun — obligatoire |
| `SAUVEGARDE_DOSSIER` | dossier local | `./sauvegardes` |
| `SAUVEGARDE_HORS_SITE` | NAS, disque externe, dossier synchronise | aucun |
| `SAUVEGARDE_RETENTION` | jours conserves | 30 |

### La phrase secrete

Elle ne se trouve nulle part dans le logiciel, et elle ne doit pas
vivre que sur le serveur : une sauvegarde chiffree dont la clef brule
avec le serveur ne vaut rien.

Gardez-en une copie ailleurs — coffre, enveloppe scellee, gestionnaire
de mots de passe du gerant. **Sans elle, aucune sauvegarde n'est
recuperable**, et c'est voulu : c'est ce qui fait qu'un disque externe
egare ne livre pas votre comptabilite.

Douze caracteres au minimum, refus en dessous.

---

## Le jour ou il faut restaurer

1. **Arreter le service GestGlobale.** Une restauration qui remplace les
   tables sous un serveur en marche le laisse avec des plans de requete
   perimes.
2. Restaurer :
   ```bash
   node apps/api/outils/restaurer.mjs sauvegardes/gestglobale-20261122-0200.sauv
   ```
3. Redemarrer le service.
4. Verifier :
   ```bash
   node apps/api/outils/temoin.mjs
   ```
   Il donne les comptes, les totaux et l'etat de la chaine d'empreintes
   du journal d'audit. `chaine_audit=intacte` signifie qu'aucune ligne
   n'a ete perdue ni retouchee.

Les caisses n'ont rien a faire : elles ont continue de vendre hors ligne
pendant la panne et remontent leurs tickets des le retour du serveur.
C'est la raison d'etre de la section 4 du cahier des charges.

### Restaurer ailleurs d'abord

Pour une restauration mensuelle de controle, visez une base d'essai
plutot que la vraie :

```bash
node apps/api/outils/restaurer.mjs ma-sauvegarde.sauv "postgresql://postgres:motdepasse@localhost:5432/gestglobale_essai"
```

---

## Ce que la sauvegarde contient, et ce qu'elle ne contient pas

**Elle contient** toute la base centrale : articles, stocks, tiers,
ventes, caisses, tresorerie, promotions, bons, transferts, personnel,
paie et le journal d'audit avec sa chaine d'empreintes.

**Elle ne contient pas** :

- Les **bases locales des caisses**. C'est sans consequence : une caisse
  qui perd sa base la reconstruit a la premiere synchronisation. Ce
  qu'elle n'aurait pas encore remonte serait en revanche perdu — d'ou
  l'interet de ne pas laisser une caisse hors ligne plus que necessaire.
- Les **fichiers deposes** (photos d'employes, documents scannes), qui
  sont references par leur adresse et non stockes en base. Le jour ou
  ces fichiers seront reellement heberges sur le serveur, leur dossier
  devra etre sauvegarde aussi.
- Le fichier `.env`, qui porte les secrets du serveur. Conservez-en une
  copie avec la phrase secrete.

---

## Ce qui est verifie, et comment

Le script d'epreuve ne se contente pas de compter des lignes : une base
rebatie peut avoir le bon nombre de lignes et des montants faux.

- Les **comptes** : articles, tickets, lignes, mouvements, tiers, bons,
  employes, bulletins, entrees d'audit.
- Les **totaux en centimes** : chiffre d'affaires, marge, stock en
  milliemes, tresorerie.
- La **chaine d'empreintes du journal d'audit**, recalculee entree par
  entree avec le code du serveur lui-meme — pas une copie. C'est elle
  qui prouve qu'aucune ligne n'a disparu ni ete retouchee en chemin.
- Qu'une **clef fausse ne restaure rien** : la marque d'authenticite du
  fichier fait echouer la lecture au lieu de rendre une base a moitie
  juste.
- Que le **fichier ne laisse rien lire en clair**.

Une sauvegarde qui produirait un fichier vide ou tronque est refusee et
effacee plutot que conservee : une sauvegarde vide que l'on croit bonne
est pire que pas de sauvegarde du tout.
