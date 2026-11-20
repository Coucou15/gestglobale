# Test de charge au volume reel

Mesure realisee le 20 novembre 2026 sur le volume annonce par l'export
`VENTES_2026.xls`, avec une base PostgreSQL et une API reellement
demarrees, et deux caisses dotees chacune de sa base SQLite.

Rejouable par `pnpm charge`.

## Volume en base

| Donnee | Volume |
|---|---|
| Articles | 30 015 |
| Codes-barres | 45 557 |
| Lignes de prix | 58 294 |
| Lignes de stock (2 emplacements) | 56 558 |
| Codes vrac | 450 |
| Packs | 1 735 |
| Clients | 7 024 dont 3 460 cartes fidelite |
| Fournisseurs | 694 |

Journee rejouee : **430 tickets sur 2 caisses**, 2 780 lignes de vente,
soit environ 6,5 articles par ticket.

## Resultats

Les durees sont la mediane et le 95e centile. Une moyenne masquerait les
a-coups, qui sont justement ce que ressent le caissier.

| Mesure | Mediane | 95e centile | Exigence |
|---|---|---|---|
| Scan d'un code-barres (base locale) | 0,0 ms | 0,1 ms | < 300 ms |
| Recherche par nom (base locale) | 14 ms | 22 ms | < 300 ms |
| Validation d'un ticket | 0,5 ms | 1,0 ms | < 1 000 ms |
| Cloture Z (calcul et ecriture) | 0,5 ms | — | < 1 000 ms |
| Recherche back-office sur 30 000 articles | 42 ms | 70 ms | < 1 000 ms |
| Lecture d'un code par l'API | 4,6 ms | 7,0 ms | < 300 ms |
| Tableau de bord du jour | 5,5 ms | 7,1 ms | < 5 000 ms |
| Rapport mensuel | 5,5 ms | 7,6 ms | < 5 000 ms |
| Top et flop produits du mois | 23 ms | 26 ms | < 5 000 ms |
| Produits dormants sur 90 jours | 35 ms | — | < 5 000 ms |
| Ecarts de caisse sur 30 jours | 6 ms | — | < 5 000 ms |
| Alertes de reassort | 176 ms | — | < 5 000 ms |
| Descente incrementale | 22 ms | — | < 5 000 ms |

**15 mesures sur 15 dans les clous**, avec une marge confortable partout.

### Descente complete du catalogue

Une caisse neuve recupere les 30 015 articles, 45 557 codes-barres et
7 718 clients en **61 pages et 28,6 secondes**. C'est une operation
d'installation, pas une operation quotidienne : au fonctionnement normal,
la descente incrementale ne rapporte que les modifications et prend
22 millisecondes.

### Remontee des tickets

**16 elements par seconde**, soit les 432 documents d'une journee en
28 secondes. Le cout est celui des allers-retours SQL : chaque ticket
ouvre sa transaction, ecrit son entete, ses lignes, ses reglements et un
mouvement de stock par ligne.

Ce chiffre est confortable au regard de l'autonomie exigee : sept jours
hors ligne representent environ 3 000 tickets, soit un peu plus de trois
minutes pour vider la file au retour du reseau. Il ne limite pas non plus
le nombre de caisses, chacune remontant par une requete distincte traitee
en parallele.

## Ce que le test a revele

Deux defauts, invisibles sur le jeu de demonstration de huit articles.

### 1. La descente ne transmettait que 500 articles sur 30 015

Le curseur de descente etait **unique et partage** par toutes les
entites : sa position retenait la date la plus recente vue, articles,
clients, promotions et utilisateurs confondus. Les clients etant modifies
apres les articles lors d'un import, le curseur sautait au-dela des
articles restants, qui n'atteignaient jamais les caisses.

Une caisse neuve recevait donc 500 articles, puis se declarait a jour.
Tout le reste du catalogue lui serait reste inconnu : articles
introuvables au scan, et ventes impossibles sur l'essentiel du magasin.

**Corrige** : le curseur porte desormais une position par entite, chacune
etant le couple (date de modification, identifiant), strictement
croissant pour l'ordre de tri employe.

### 2. Un changement de prix ne descendait pas

La requete tentait de rattraper les prix modifies par une condition sur
la table liee. Cette condition ne pouvait pas etre parcourue par curseur :
un article dont seul le prix changeait n'etait servi que par hasard.

**Corrige** : deux declencheurs PostgreSQL remontent la date de
modification de l'article des qu'un de ses prix ou de ses codes-barres
bouge. La descente se contente alors d'un critere simple et sur, appuye
sur un index dedie `(modifieLe, id)`.

## Deux changements de robustesse, nes de la meme campagne

**Numerotation des journaux internes.** Les mouvements de stock et les
operations de tresorerie tiraient leur numero d'un compteur en table,
incremente par un UPDATE qui verrouille la ligne jusqu'a la fin de la
transaction : toutes les caisses se seraient mises dans la meme file. Ils
utilisent desormais une sequence PostgreSQL, qui ne verrouille rien.

Mesure honnete : ce changement **n'a pas ameliore le debit** de la
remontee, qui est borne par le nombre d'allers-retours SQL et non par ce
verrou. Il est conserve parce qu'il leve un point de contention qui se
serait manifeste avec plusieurs caisses simultanees.

Les documents a valeur legale — factures, bons de commande, receptions,
inventaires — gardent le compteur sans trou.

**Ordre des verrous de stock.** Deux tickets concurrents portant les memes
articles dans un ordre de lignes different verrouillaient les memes
lignes de stock en ordre inverse, situation dont PostgreSQL ne sort qu'en
abattant une des deux transactions — le ticket aurait ete refuse alors
qu'il etait deja encaisse.

Je n'ai pas reussi a provoquer l'interblocage sur 122 tickets concurrents
(`apps/pos/test/concurrence.mjs`). Les sorties de stock sont neanmoins
triees par article avant d'etre appliquees : l'ordre deterministe rend le
cas impossible, et il ne coute rien.

## Limites de cette mesure

- Le materiel du conteneur de test n'est pas le ProLiant ML330 G6 du
  client, qui date d'environ 2010 et n'a pas de disque SSD. **Les durees
  seront moins bonnes sur le serveur reel**, surtout a l'ecriture. Les
  marges constatees — un a deux ordres de grandeur sous chaque seuil —
  laissent de la place, mais la mesure est a refaire sur place.
- Les 5 ans d'historique exiges par la section 8 ne sont pas simules : la
  base ne contient qu'une journee de ventes. Les rapports de periode
  seront a remesurer sur plusieurs annees.
- Les 30 caisses et 50 utilisateurs simultanes de la section 8 ne sont pas
  simules non plus : le test emploie 2 caisses, comme aujourd'hui.
