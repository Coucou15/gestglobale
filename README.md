# GestGlobale — ERP pour superettes

Remplace l'ancien logiciel de gestion par un ERP centralise, accessible sur
le reseau interne et par Internet, **dont les caisses vendent sans reseau**.

Ce depot contient le socle du lot 1 du cahier des charges : les modules M1
a M8, l'assistant de migration et la caisse hors ligne.

---

## Ce qui tourne aujourd'hui

| Composant | Etat |
|---|---|
| Serveur central (API + PostgreSQL) | 13 modules, 54 tables, operationnel |
| Caisse hors ligne (Electron + SQLite) | vend, encaisse, cloture et resynchronise sans reseau |
| Back-office web (React) | tableau de bord, articles, stocks, receptions, inventaires, caisses, tiers, tresorerie, audit |
| Assistant d'import | lit l'export Excel de l'ancien logiciel, le controle et le charge |

**114 verifications automatisees** passent contre une vraie base et une
API reellement demarree : `pnpm recette`.

Le parcours de saisie est verifie dans un vrai navigateur, de la
reception a l'inventaire jusqu'au cloisonnement des droits :
`node apps/backoffice/test-navigateur.mjs`, API et back-office demarres.

Un **test de charge au volume reel** (30 015 articles, 430 tickets sur
2 caisses) tient les quatre exigences chiffrees de la section 8 avec un a
deux ordres de grandeur de marge : `pnpm charge`. Il a revele deux
defauts majeurs de la synchronisation, corriges ; le detail est dans
[`docs/test-de-charge.md`](docs/test-de-charge.md).

---

## Demarrage

Prerequis : Node 20 ou plus, pnpm, PostgreSQL 14 ou plus.

```bash
pnpm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

Renseignez `DATABASE_URL` puis **regenerez les secrets** :

```bash
openssl rand -hex 32
```

```bash
cd apps/api && npx prisma migrate deploy && pnpm seed
```

```bash
pnpm dev:api
```

Le back-office demarre a part :

```bash
pnpm dev:bo
```

La documentation de l'API est servie sur `/api/doc`.

### Identifiants de demonstration

Le jeu de donnees cree 11 comptes, comme dans l'ancien logiciel.
Gerant : `gerant` / `GestGlobale2026!`. Caisse : code `3`, PIN `1234`.

> Ces identifiants sont ceux d'une base de demonstration.
> **Changez-les avant toute mise en service.**

### Caisse

```bash
pnpm --filter @gestglobale/pos build
```

Au premier lancement, la caisse ecrit un gabarit de configuration dans le
dossier de donnees de l'application et s'arrete : completez-le avec
l'adresse du serveur, le code du magasin et le numero de caisse, puis
relancez.

```bash
pnpm --filter @gestglobale/pos demarrer
```

---

## Conventions que tout le code respecte

Trois regles expliquent la plupart des choix de ce depot.

**Les montants sont des entiers de centimes.** Aucun calcul monetaire
n'utilise de nombre flottant, nulle part. Les colonnes portent le suffixe
`...Centimes`. La somme de 1 752 lignes de ticket tombe au centime pres.

**Les quantites sont des entiers de milli-unites.** Suffixe `...Milli`.
C'est ce qui permet de vendre 0,250 KG sans derive, et de refuser une
demi-piece.

**L'historique ne se modifie jamais.** Un mouvement de stock, une ligne de
ticket, une entree d'audit ne sont ni mis a jour ni supprimes : on ajoute
une contre-ecriture. Le stock est toujours egal a la somme de ses
mouvements.

---

## La caisse hors ligne

C'est le coeur du systeme, et le plus gros risque du projet.

La caisse possede sa propre base SQLite avec une copie du catalogue, des
prix, des clients et des droits. **Elle vend toujours sur cette base ; le
serveur n'est jamais attendu pour encaisser.**

- **Descente** : toutes les 1 a 5 minutes, la caisse recupere ce qui a
  change depuis son curseur. Le curseur est le couple (date, identifiant),
  strictement croissant : aucune ligne ne peut etre sautee ni servie deux
  fois.
- **Remontee** : tickets, clotures et mouvements partent en file d'envoi.
  Un element n'est retire de la file **qu'apres accuse de reception**.
- **Numerotation** : la caisse numerote seule (`SV-03-000125`), donc ses
  numeros restent uniques meme coupee du serveur. Ce numero porte une
  contrainte d'unicite en base : un ticket renvoye apres un accuse perdu
  est reconnu, jamais redouble.
- **Conflits** : le serveur fait foi pour les prix, la caisse fait foi pour
  les ventes realisees. Un ticket passe a un ancien prix est conserve tel
  quel et signale dans un rapport.
- **Voyant** : vert en ligne, orange des qu'un ticket attend, rouge
  au-dela de 24 heures sans synchronisation.

### Le test qui compte

`apps/pos/test/coupure-reseau.test.ts` rejoue le critere de reception de la
section 4 : ouvrir une session, vendre 121 tickets cable debranche,
cloturer la caisse, rebrancher, et retrouver au serveur 100 % des tickets,
des mouvements de stock et des encaissements, sans doublon.

Ce test a revele quatre defauts reels, tous corriges :

1. le prix d'un pack vit dans la categorie `PACK` et ne descendait pas vers
   la caisse, qui aurait vendu le carton de 12 laits a zero dinar ;
2. la limite de corps JSON d'Express (100 Ko) faisait echouer
   indefiniment la remontee d'une centaine de tickets ;
3. **le serveur refusait des ventes deja encaissees** pour stock
   insuffisant — voir ci-dessous ;
4. les mouvements de tiroir etaient traites apres la cloture alors qu'ils
   la precedent, et se voyaient refuses sur une session fermee.

### Stock negatif : une decision a connaitre

Le cahier des charges demande d'interdire le stock negatif. Cette
interdiction s'applique aux operations **a venir** : sortie saisie au
back-office, transfert, casse.

Elle ne peut pas s'appliquer a une vente **deja encaissee**. Quand une
caisse remonte un ticket apres une coupure, le client est parti avec la
marchandise depuis longtemps. Refuser le mouvement ferait perdre la
recette sans faire revenir le produit. GestGlobale enregistre donc la
vente, laisse le stock passer en negatif, et le signale dans
`Stocks > Stocks negatifs` avec sa valeur au CUMP, pour correction par
inventaire.

---

## La cloture Z

L'export du 01/11/2026 montre une recette physique a 0 et des ecarts de
-72 171 DA et -96 637 DA : le comptage n'etait pas saisi.

Dans GestGlobale :

- le **comptage par coupure est obligatoire** ; aucune cloture sans lui ;
- l'ecart est **toujours calcule**, jamais remis a zero ;
- une **justification est exigee** des qu'il n'est pas nul ;
- la cloture est **bloquante** : pas de nouvelle ouverture sans elle ;
- le rapport `Caisses` donne l'ecart cumule, moyen et le pire ecart **par
  caissier** sur 30 jours.

Un point a connaitre : un total de ticket tombe sur n'importe quel
centime, alors que la plus petite coupure vaut 5 DA. Le theorique en
especes comporte donc souvent une fraction qu'aucun comptage physique ne
peut atteindre. GestGlobale rend cet ecart visible plutot que de le
masquer. **Si vous souhaitez un arrondi du rendu en especes au multiple de
5 DA, c'est une decision de gestion a prendre avec votre comptable** ; le
parametre existe, il n'est pas active par defaut.

---

## Migration depuis l'ancien logiciel

L'assistant lit l'export Excel, **retrouve les colonnes par leur intitule**
et non par leur position : un export d'une autre version reste lisible.

Nettoyage applique automatiquement (section 7), verifie par 23 tests :

- unites normalisees `U → UN`, `K → KG`, `GR → KG` avec conversion des
  quantites ; les valeurs aberrantes (« . », « + », « 28272 ») sont listees
  pour correction sans bloquer la bascule ;
- lignes « NOMBRE ITEMS » de fin d'onglet ignorees ;
- dates « 00/00/0000 » converties en vide ;
- seuils d'alerte negatifs remis a zero ;
- codes commencant par 0 conserves en texte, sans quoi « 00042 » ne
  correspondrait plus a son etiquette balance ;
- codes-barres en doublon refuses ;
- articles a stock nul archives, **jamais supprimes** ;
- stocks negatifs signales pour inventaire avant bascule.

L'assistant reconnait le format par le contenu et non par l'extension :
un classeur `.xlsx` ou un fichier texte sont lus directement, tandis qu'un
vrai `.xls` binaire, un tableau HTML renomme `.xls` ou du XML Excel 2003
donnent une consigne de conversion claire au lieu d'une erreur technique.
Voir [`docs/transmettre-lexport.md`](docs/transmettre-lexport.md).

Deroule :

1. `POST /api/v1/import/analyse` — import a blanc, n'ecrit rien, rend le
   rapport d'erreurs et de doublons ;
2. le gerant corrige les anomalies dans le fichier ;
3. le soir de la bascule, apres la derniere cloture de l'ancien logiciel,
   `POST /api/v1/import/executer` charge tout dans une transaction unique ;
4. `GET /api/v1/import/controles` donne le nombre d'articles, la valeur du
   stock au CUMP et le total des soldes tiers, **a comparer avec l'ancien
   logiciel**.

Le fichier transmis ne couvre qu'une journee (01/11/2026). Pour reprendre
l'historique complet, il faudra un export sur toute la periode voulue, ou
un acces direct a la base de l'ancien logiciel.

---

## Droits

Six roles suivent la matrice de la section 6, et chaque droit peut etre
ajoute ou retire individuellement. **Un retrait l'emporte toujours sur un
ajout.**

Verifie par les tests : un caissier ne peut ni annuler un ticket, ni
modifier un prix, ni voir les marges — le serveur ne lui renvoie meme pas
les champs de cout.

Le journal d'audit est non modifiable : chaque entree porte l'empreinte de
la precedente. `GET /api/v1/audit/integrite` recalcule la chaine et
detecte toute ligne retouchee ou supprimee directement en base.

---

## Recette

```bash
pnpm recette
```

Le script construit, prepare une base fraiche pour chaque suite, demarre
le serveur et enchaine :

| Suite | Verifications |
|---|---|
| Noyau metier (hors base, hors reseau) | 33 |
| Nettoyage a l'import | 23 |
| Recette fonctionnelle du lot 1 | 38 |
| Coupure reseau de la caisse | 20 |

```bash
pnpm charge
```

Ajoute le test de charge au volume reel : generation de 30 000 articles,
journee de 430 tickets sur 2 caisses, 15 mesures de performance et un
essai de remontee simultanee. Comptez une dizaine de minutes.

Chaque suite part d'une base fraiche : la numerotation des documents est
deterministe par caisse, donc rejouer une suite sur une base deja remplie
ferait acquitter les documents comme « deja recus » — comportement
attendu, mais qui masquerait les verifications.

---

## Structure

```
apps/api          serveur central : NestJS, Prisma, PostgreSQL
apps/pos          caisse : Electron, SQLite, React
apps/backoffice   back-office web : React, Vite
packages/shared   noyau metier partage par les trois
scripts/          recette
docs/             suivi du cahier des charges
```

`packages/shared` porte tout ce qui doit donner le meme resultat au
serveur et a la caisse : arithmetique monetaire, CUMP, totaux et TVA,
droit de timbre, lecture des etiquettes balance, calcul de cloture,
plafond de credit, matrice des droits, contrats de synchronisation.
C'est ce partage qui garantit qu'un ticket hors ligne et un ticket en
ligne produisent exactement les memes ecritures.

---

## Ce qui reste a faire

L'etat detaille, module par module, est dans
[`docs/etat-du-projet.md`](docs/etat-du-projet.md).

En resume : le lot 1 est pose et verifie, saisie comprise. Restent
l'empaquetage Windows de la caisse, les documents de vente a valeur legale
(factures, bons de livraison, proformas), puis les lots 2 et 3 (rapports,
fidelite, multi-magasins, comptabilite, personnel).

Plusieurs points demandent une decision de votre part avant d'aller plus
loin ; ils sont listes a la fin du meme document.
