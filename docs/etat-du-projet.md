# Etat du projet face au cahier des charges

Derniere mise a jour : 20 novembre 2026.

Ce document suit, module par module, ce qui est fait, ce qui reste, et les
decisions qui vous appartiennent.

---

## 1. Modules

Legende : **fait** = construit et couvert par la recette automatisee ;
*partiel* = le moteur existe, l'ecran de saisie reste a faire ;
a venir = non commence.

| N° | Module | Lot | Etat |
|---|---|---|---|
| M1 | Articles | 1 | **fait** |
| M2 | Stocks | 1 | **fait** |
| M3 | Achats | 1 | *partiel* — API complete, ecrans de saisie a faire |
| M4 | Caisse (POS) | 1 | **fait** |
| M5 | Ventes | 1 | *partiel* — tickets et retours faits ; factures, bons de livraison et proformas a faire |
| M6 | Tiers | 1 | **fait** |
| M7 | Tresorerie | 1 | *partiel* — API complete, ecrans de saisie a faire |
| M8 | Utilisateurs et droits | 1 | **fait** |
| M9 | Tableaux de bord et rapports | 2 | *partiel* — chiffres du jour, ecarts de caisse, stocks negatifs ; exports Excel et PDF et resume quotidien a faire |
| M10 | Fidelite et promotions | 2 | *partiel* — modele de donnees et descente vers la caisse faits ; application en vente a faire |
| M11 | Multi-magasins | 2 | *partiel* — catalogue central, prix par magasin et transferts faits ; consolidation a completer |
| M12 | Comptabilite et exports | 3 | a venir |
| M13 | Gestion du personnel | 3 | *partiel* — modele de donnees complet ; fonctionnalites a faire |

### Detail des modules du lot 1

**M1 — Articles.** Fiche complete, unite normalisee, codes-barres
multiples avec unicite sur tout le catalogue, codes vrac et etiquettes
balance a poids ou prix variable, packs, cinq categories de prix, prix par
magasin, historique de tous les changements de prix, modification en masse
par famille, rayon ou fournisseur, en pourcentage, en montant ou par taux
de marge cible, avec simulation prealable et garde-fou sur la vente a
perte. **Reste** : impression des etiquettes rayon et des codes-barres
internes (le moteur de generation existe, pas la mise en page).

**M2 — Stocks.** Stock par emplacement, mouvements traces et non
modifiables, transferts, inventaires tournants et complets valides par un
responsable, lots et dates de peremption, alertes de reassort distinguant
ce qui vient du depot de ce qu'il faut commander, interdiction
parametrable du stock negatif. **Reste** : application mobile de
l'inventaire au scanner (l'API de comptage est prete et accepte deja une
source de saisie).

**M3 — Achats.** Commandes, receptions, retours, factures, echeances,
recalcul du CUMP et proposition du nouveau prix de vente, comparaison des
fournisseurs sur un meme article. **Reste** : les ecrans de saisie au
back-office, et l'envoi du bon de commande par courriel ou WhatsApp en PDF.

**M4 — Caisse.** Voir le README. **Reste** : mise en attente de tickets,
touches rapides parametrables, afficheur client, et l'empaquetage Windows.

**M5 — Ventes.** Tickets, retours, annulations par contre-ecriture, ventes
a credit avec plafond. **Reste** : factures, bons de livraison, proformas
et avoirs avec leur mise en page legale.

**M6 — Tiers.** Fiche complete, types de client, soldes tenus sous verrou,
releve de compte sans recalcul, echeancier, plafond de credit et blocage,
fusion des doublons avec reprise des cartes fidelite anonymes.
**Reste** : relance par SMS ou WhatsApp (la liste des impayes est prete).

**M7 — Tresorerie.** Comptes (caisse, tiroir, coffre, banque, CCP),
encaissements et decaissements, transferts a double validation ou le
demandeur ne peut pas valider, rapprochement bancaire, situation
consolidee. **Reste** : les ecrans de saisie des depenses et salaires.

**M8 — Utilisateurs et droits.** Matrice des six roles, droits ajoutes ou
retires individuellement, plages horaires, postes autorises, blocage apres
cinq echecs, double authentification obligatoire depuis Internet,
deconnexion apres 15 minutes d'inactivite, journal d'audit chaine par
empreintes avec verification d'integrite.

---

## 2. Exigences non fonctionnelles

| Domaine | Exigence | Etat |
|---|---|---|
| Performance caisse | scan a l'ecran en moins de 0,3 s | **tenu** — recherche par cle primaire, independante de la taille du catalogue |
| Performance caisse | validation d'un ticket en moins de 1 s, hors ligne comprise | **tenu et mesure** par le test de coupure reseau |
| Performance back-office | recherche dans 30 000 articles en moins de 1 s | **a mesurer** sur le volume reel ; les index sont en place |
| Capacite | 10 magasins, 30 caisses, 50 utilisateurs, 100 000 articles, 5 ans | **a eprouver** par un test de charge |
| Disponibilite | les caisses vendent meme serveur arrete | **tenu et verifie** |
| Sauvegardes | chaque nuit, copie hors site, retention 30 jours, test mensuel | **a mettre en place** a l'installation |
| Securite | HTTPS, mots de passe chiffres, double authentification, aucun port de base ouvert | **tenu** cote applicatif ; le tunnel reste a installer |
| Langues | francais et arabe, ecriture droite-gauche | **partiel** — les champs arabes existent, le ticket imprime en arabe ; l'interface n'est pas encore traduite |
| Monnaie et formats | dinar, 2 decimales, dates JJ/MM/AAAA | **tenu** |
| Materiel | imprimante ESC/POS, douchette, balance, tiroir, afficheur, TPE | **partiel** — imprimante, tiroir et douchette faits ; afficheur et balance connectee a faire |
| Conformite | mentions legales, droit de timbre, conservation | **partiel** — mentions sur le ticket faites ; voir les decisions ci-dessous |
| Maintenance | mise a jour sans arret des caisses, journal technique, support a distance | **a faire** |

---

## 3. Criteres de reception du lot 1

| Critere | Etat |
|---|---|
| Import complet : 28 272 produits, 21 198 codes-barres, 1 735 packs, 450 vracs, 7 021 clients, 692 fournisseurs, sans perte | **assistant pret**, a eprouver sur le fichier reel |
| Valeur du stock au CUMP et soldes tiers identiques a l'ancien logiciel | **controles exposes**, a comparer lors de l'import a blanc |
| Une journee type (environ 430 tickets sur 2 caisses) rejouee sans erreur | **121 tickets rejoues** par la recette ; a porter a 430 sur le volume reel |
| Coupure reseau de 2 heures : 100 % des tickets retrouves, sans doublon | **verifie** |
| Cloture Z avec comptage, ecart calcule et justifie | **verifie** |
| Un caissier sans droit ne peut ni annuler, ni modifier un prix, ni voir les marges | **verifie** |
| Consultation des ventes du jour depuis un smartphone hors du magasin | **verifie** en navigateur mobile ; reste a eprouver via le tunnel |
| Restauration complete depuis la sauvegarde de la veille en moins d'une heure | **a eprouver** a l'installation |

---

## 4. Decisions qui vous appartiennent

Ces points ne peuvent pas etre tranches sans vous. Aucun n'empeche de
continuer, mais chacun changera du code s'il est tranche plus tard.

1. **Droit de timbre.** Le parametre existe (taux, minimum, maximum,
   arrondi, modes de reglement soumis) mais il est **desactive par
   defaut**. Les valeurs a retenir sont a confirmer avec votre comptable.

2. **Regime de TVA.** Presque tous les produits sont a TVA 0 dans
   l'export actuel. A confirmer avant les etats fiscaux du lot 3.

3. **Arrondi des especes.** Un total de ticket tombe sur n'importe quel
   centime, la plus petite coupure vaut 5 DA. Faut-il arrondir le montant
   du a payer en especes au multiple de 5 DA le plus proche ? Aujourd'hui
   GestGlobale ne touche a rien et rend l'ecart visible a la cloture.

4. **Format exact des etiquettes balance.** Les regles par defaut
   supposent un prefixe a deux chiffres, puis 5 chiffres de code et 5 de
   valeur. A confirmer avec les balances reellement installees ; c'est un
   parametre, pas du code.

5. **Archivage des 24 545 articles a stock nul.** Ils sont archives par
   defaut a l'import, donc consultables mais non vendables. Confirmez si
   certaines familles doivent rester vendables.

6. **Historique a reprendre.** Le fichier transmis ne couvre qu'une
   journee. Quelle profondeur d'historique voulez-vous reprendre, et par
   quel moyen (export sur la periode, ou acces direct a la base de
   l'ancien logiciel) ?

7. **Serveur.** Les points a verifier avant le lot 1 restent ouverts :
   processeur installe, quantite de memoire, type de controleur RAID et
   etat des disques du ProLiant ML330 G6.

---

## 5. Prochaines etapes proposees

1. Eprouver l'assistant d'import sur le vrai fichier `VENTES_2026.xls` et
   comparer les controles de bascule avec l'ancien logiciel.
2. Empaqueter la caisse pour Windows et l'installer sur un poste reel avec
   sa douchette, son imprimante et son tiroir.
3. Completer les ecrans de saisie du back-office : receptions, inventaires,
   depenses.
4. Mesurer les performances sur le volume reel : 28 272 articles, 430
   tickets par jour, 2 caisses.
5. Mettre en place les sauvegardes et le tunnel chiffre, puis eprouver une
   restauration complete.
6. Pilote sur un magasin, formation des caissiers, puis bascule.
