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
| M3 | Achats | 1 | **fait** — ecrans de saisie compris ; reste l'envoi du bon de commande par courriel ou WhatsApp |
| M4 | Caisse (POS) | 1 | **fait** |
| M5 | Ventes | 1 | **fait** — tickets, retours, factures, bons de livraison, proformas et avoirs |
| M6 | Tiers | 1 | **fait** |
| M7 | Tresorerie | 1 | **fait** — depenses, salaires, apports, retraits et transferts a double validation |
| M8 | Utilisateurs et droits | 1 | **fait** |
| M9 | Tableaux de bord et rapports | 2 | **fait** — sept rapports, chacun exportable en Excel et en PDF, et resume quotidien du gerant ; reste a fournir un relais de messagerie pour l'envoi |
| M10 | Fidelite et promotions | 2 | **fait** — promotions, points de fidelite, cartes cadeaux et bons d'achat, appliques en caisse hors ligne comprise |
| M11 | Multi-magasins | 2 | **fait** — catalogue central, prix par magasin, transferts inter-magasins a deux temps avec bon d'expedition et bon de reception, consolidation du groupe |
| M12 | Comptabilite et exports | 3 | **fait** — journaux des ventes, des achats et de tresorerie, exports CSV, Excel et PDF, etat pour les declarations ; le regime fiscal reste a confirmer avec le comptable |
| M13 | Gestion du personnel | 3 | **fait** — dossiers, contrats, pointage, plannings, conges, avances, paie, documents et performance ; les taux de cotisations et d'IRG restent a valider avec le comptable |

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
parametrable du stock negatif. L'ecran d'inventaire separe la saisie du
comptage de la validation, et dit a celui qui ne peut pas valider
pourquoi. **Reste** : application mobile de l'inventaire au scanner
(l'API de comptage est prete et accepte deja une source de saisie).

**M3 — Achats.** Commandes, receptions, retours, factures, echeances,
recalcul du CUMP et proposition du nouveau prix de vente, comparaison des
fournisseurs sur un meme article. L'ecran de reception se tient a la
douchette : la reception naît en brouillon, et la fenetre de validation
montre le CUMP avant et le prix de vente propose avant de s'engager.
**Reste** : l'envoi du bon de commande par courriel ou WhatsApp en PDF.

**M4 — Caisse.** Voir le README. L'application est empaquetee : ecran
d'installation du poste, installateur unique, base locale recompilee pour
Electron. Eprouvee de bout en bout sous Electron, d'un poste vierge
jusqu'au ticket remonte. **Reste** : executer l'installateur sur une vraie
machine Windows, signer le code, fournir l'icone ; puis mise en attente de
tickets, touches rapides parametrables et afficheur client.

**M5 — Ventes.** Tickets, retours, annulations par contre-ecriture, ventes
a credit avec plafond. Factures, bons de livraison, proformas et avoirs
etablis au back-office : numerotation sans trou par type et par annee,
mentions legales figees a l'emission, montant en toutes lettres,
impression A4. Une proforma se transforme en facture ou en bon de
livraison, un bon de livraison en facture, une facture en avoir — chaque
transformation une seule fois. **Reste** : l'envoi par courriel, qui
demandera une generation PDF cote serveur.

**M6 — Tiers.** Fiche complete, types de client, soldes tenus sous verrou,
releve de compte sans recalcul, echeancier, plafond de credit et blocage,
fusion des doublons avec reprise des cartes fidelite anonymes.
**Reste** : relance par SMS ou WhatsApp (la liste des impayes est prete).

**M7 — Tresorerie.** Comptes (caisse, tiroir, coffre, banque, CCP),
encaissements et decaissements, transferts a double validation ou le
demandeur ne peut pas valider, rapprochement bancaire, situation
consolidee. Les comptes d'especes — caisse, tiroir, coffre — refusent un
solde negatif, puisqu'on ne sort pas des billets qui ne sont pas la ;
banque et CCP admettent un decouvert. Une avance sur salaire se rattache a
son employe et se deduit de sa paie suivante (M13).

**M8 — Utilisateurs et droits.** Matrice des six roles, droits ajoutes ou
retires individuellement, plages horaires, postes autorises, blocage apres
cinq echecs, double authentification obligatoire depuis Internet,
deconnexion apres 15 minutes d'inactivite, journal d'audit chaine par
empreintes avec verification d'integrite.

### Detail du module du lot 2 deja livre

**M9 — Tableaux de bord et rapports.** Sept rapports, tous exportables
en Excel et en PDF.

La synthese donne le chiffre d'affaires, la marge, le nombre de tickets
et le panier moyen, declines par jour, par heure, par caisse, par
caissier et par rayon et famille — les axes que demande la section 9.
Viennent ensuite le palmares des ventes, les produits dormants, les
ruptures et franchissements de seuil, les produits vendus sous leur
CUMP, les ecarts de caisse par caissier, et le journal des annulations
et des remises.

Les trois formes — ecran, Excel, PDF — sortent d'une **seule description
par rapport**. C'est deliberé : des exports decrits a part finissent
toujours par s'ecarter de ce que montre l'ecran, et le gerant ne sait
plus lequel croire. Ici le fichier ne peut pas diverger.

Dans l'Excel, les montants sont des nombres au format comptable, pas du
texte : le comptable peut sommer et filtrer. L'entete est figee et un
filtre automatique est pose. Le PDF est en A4 paysage — le journal des
remises a dix colonnes, illisibles en portrait — et produit sans
navigateur, parce qu'installer Chromium sur le ProLiant du client pour
fabriquer un PDF serait disproportionne.

**Le resume quotidien** part chaque matin au gerant a l'heure qu'il
choisit : recette, marge, tickets, panier moyen, reglements, heure la
plus forte, puis les points de vigilance — clotures manquantes, ecarts
de caisse, ecarts sans motif, annulations, ventes a perte, ruptures. Il
est **toujours produit et conserve**, meme sans relais de messagerie :
le gerant le retrouve alors dans le back-office, et la raison de son
non-envoi y figure. Un rapport qu'on ne peut pas envoyer vaut mieux
qu'un rapport qui n'existe pas — c'est precisement ce que le client
reprochait a son ancien logiciel, dont les chiffres n'arrivaient nulle
part.

**M11 — Multi-magasins.** Le catalogue et les prix sont definis au
siege et declinables par magasin. Deux choses s'y ajoutent.

**Les transferts inter-magasins se font en deux temps** : un bon
d'expedition au depart, un bon de reception a l'arrivee. Entre les deux,
la marchandise est **en transit** — dans aucun rayon, mais toujours dans
les comptes du magasin expediteur, jusqu'a ce que quelqu'un signe pour
elle.

Ce n'est pas un detail de procedure. Traiter un transfert en un seul
geste ferait apparaitre a 8 h, dans le magasin d'arrivee, une palette
encore sur le camion — et ferait disparaitre la marchandise des deux
magasins si le camion n'arrivait jamais.

Ce qui arrive peut differer de ce qui est parti. L'ecran de reception
demande donc un **comptage**, jamais une simple validation. L'ecart
apparait des la saisie, un motif est demande, et il reste au compte du
magasin expediteur — c'est lui qui a laisse partir la marchandise. Un
bon expedie et jamais receptionne figure dans un rapport dedie, avec son
anciennete : c'est de l'argent dont personne ne repond.

Expedier plus qu'on ne possede est refuse, contrairement a une vente
deja encaissee : rien n'a encore eu lieu, on peut donc dire non.

**La consolidation** met les superettes cote a cote sur une page :
ventes, marge, panier moyen, valeur du stock, marchandise en transit,
tresorerie et ruptures, magasin par magasin puis additionnes. La
tresorerie du siege y figure a part, parce qu'elle n'appartient a aucun
magasin. La marchandise en transit a sa colonne : la confondre avec du
stock vendable ferait croire a une disponibilite qui n'existe pas.

**M13 — Gestion du personnel.** Dossiers d'employes, contrats,
pointage, plannings, conges, avances, paie, documents et performance.

**Un depart coupe les acces.** C'est la faille classique d'un commerce :
un caissier parti dont le code PIN ouvre encore la caisse. Enregistrer
une sortie ferme le dossier, clot les contrats, desactive le compte et
revoque ses jetons, le tout dans une seule transaction — il n'y a rien
a ne pas oublier. Le compte est en outre verifie actif a **chaque
requete**, et pas seulement a la connexion : sans cela, la session
ouverte au moment du depart restait valable un quart d'heure.

**Les taux de paie ne sont pas dans le code.** Cotisations sociales,
tranches d'impot et majoration des heures supplementaires viennent d'un
bareme parametrable, conserve sur chaque bulletin : un bulletin de l'an
dernier reste justifiable avec les taux de l'an dernier. Les valeurs
par defaut sont plausibles pour l'Algerie mais **doivent etre validees
par votre comptable** avant la premiere paie — le cahier des charges le
demande explicitement, et le logiciel ne peut pas le deviner.

Un bulletin se compose de faits deja enregistres ailleurs : le contrat
donne le salaire et les primes fixes, le pointage les heures, les
absences les retenues, les avances ce qui reste a rembourser. Rien
n'est saisi deux fois. Le calcul lui-meme vit dans le noyau partage,
avec ses tests, pour pouvoir etre rejoue et verifie sans base de
donnees.

**Retenir un ecart de caisse sur un salaire reste desactive par
defaut.** Le cahier des charges le prevoit « si la regle interne le
prevoit » : c'est une decision du client, pas un effet de bord du
logiciel. L'ecart est signale sur le bulletin sans etre preleve tant
que vous ne l'avez pas decide.

Les salaires et les dossiers ne sont visibles que du gerant et du
comptable. Chaque employe accede en revanche a ses propres bulletins et
a son solde de conges, depuis son telephone, et a rien d'autre : tirer
le document d'un collegue est refuse.

**M5 — Documents de vente, en PDF aussi.** Factures, bons de livraison,
proformas et avoirs se telechargent en PDF depuis le back-office, et
surtout se fabriquent **cote serveur**, sans navigateur : c'est ce qui
permettra de les joindre a un courriel sans qu'une personne clique
quelque part.

L'impression HTML reste pour qui imprime depuis son ecran. Les deux
rendus partent du meme document et portent les memes mentions — une
facture dont le PDF differerait de l'impression serait pire qu'une
absence de PDF, puisque le client et le comptable ne sauraient plus
laquelle fait foi. Une facture de plusieurs pages rappelle son numero
et son client sur chaque feuille, et un document annule porte son
filigrane sur toutes.

**M12 — Comptabilite et exports.** Trois journaux — ventes, achats,
tresorerie — et un etat pour les declarations. Ils sortent des memes
ecritures que les rapports du gerant, mais presentes comme un comptable
les attend : une ligne par piece, dans l'ordre des dates, avec son
numero, son tiers et sa ventilation de TVA.

Chacun s'exporte en **CSV** pour le logiciel du comptable, en **Excel**
pour le travail a la main, en **PDF** pour l'archive. Le format exact
que son cabinet attend n'etant pas connu, le separateur, la decimale et
la marque d'encodage sont des reglages de l'ecran, pas des constantes.
Par defaut : point-virgule, virgule decimale, marque d'encodage — ce
qu'Excel en version francaise sait ouvrir d'un double-clic.

Les pieces annulees figurent au journal avec leur statut plutot que
d'en etre retirees : effacer une piece annulee laisserait un trou dans
la numerotation que personne ne pourrait expliquer.

**L'etat pour les declarations n'est pas une declaration remplie**, et
l'ecran le dit. Il donne le chiffre d'affaires et la TVA par taux, la
TVA deductible sur achats, le droit de timbre, et la difference entre
collectee et deductible. Seul votre comptable peut reporter ces
montants dans les cases du formulaire. Ce que GestGlobale garantit,
c'est que chaque total vient des pieces, au centime, et qu'on peut
remonter de ce tableau aux lignes qui le composent.

Sur les donnees reprises de l'ancien logiciel, **toutes les ventes sont
a TVA 0**. L'etat le signale au lieu de le masquer : c'est precisement
le point a trancher avec votre comptable.

**M10 — Promotions, fidelite, cartes cadeaux.** Quatre sortes de
promotions (prix barre, X achetes Y offerts, remise par famille, happy
hour avec plage horaire pouvant franchir minuit), declarees au
back-office et appliquees par les caisses meme sans reseau. Les
promotions non cumulables se resolvent toujours en faveur du client, et
le resultat ne depend pas de l'ordre dans lequel elles ont ete saisies.

Les points de fidelite se creditent a chaque ticket nominatif selon un
bareme parametrable par magasin, et se depensent en les convertissant en
bon d'achat : un bon porte un code, une date, un emetteur et une trace
de chaque passage, ce qu'une remise en points n'aurait pas. Les cartes
cadeaux s'emettent par lots de 200 au plus, avec ou sans expiration, et
s'annulent avec motif en cas de perte.

**Une carte cadeau est de l'argent au porteur**, et c'est la que se joue
l'essentiel. Une caisse privee de reseau ne connait que le solde de sa
derniere synchronisation : si deux caisses acceptent la meme carte
pendant la meme coupure, elle est depensee deux fois. On ne peut pas
l'eviter sans refuser les bons pendant les coupures, ce que la section 4
interdit en substance. Le logiciel garantit donc ce qui peut l'etre :

- les deux ventes tiennent — la marchandise est partie, le client est
  dehors ;
- le solde ne devient jamais negatif, ni en caisse ni au serveur ;
- le manque remonte au centime dans un rapport destine au gerant, avec
  le ticket, la caisse et la mention « hors ligne » pour qu'il sache
  qu'aucun caissier n'a faute ;
- une carte annulee acceptee par une caisse en retard de synchronisation
  ne voit **pas** son solde partir : le client qui a declare sa carte
  perdue en recevra une autre du meme montant, et la totalite de la
  vente apparait au rapport.

Un code que la caisse n'a jamais vu est en revanche refuse : elle
n'invente pas d'argent. Le message invite alors a synchroniser, car le
bon vient peut-etre d'etre emis.

---

## 2. Exigences non fonctionnelles

| Domaine | Exigence | Etat |
|---|---|---|
| Performance caisse | scan a l'ecran en moins de 0,3 s | **tenu** — recherche par cle primaire, independante de la taille du catalogue |
| Performance caisse | validation d'un ticket en moins de 1 s, hors ligne comprise | **tenu et mesure** par le test de coupure reseau |
| Performance back-office | recherche dans 30 000 articles en moins de 1 s | **tenu et mesure** — 42 ms median, 70 ms au 95e centile sur 30 015 articles |
| Performance rapports | rapport mensuel en moins de 5 s | **tenu et mesure** — 5,5 ms |
| Capacite | 10 magasins, 30 caisses, 50 utilisateurs, 100 000 articles, 5 ans | **partiellement eprouve** — 30 000 articles et 2 caisses mesures ; 30 caisses simultanees et 5 ans d'historique restent a simuler |
| Disponibilite | les caisses vendent meme serveur arrete | **tenu et verifie** |
| Sauvegardes | chaque nuit, copie hors site, retention 30 jours, test mensuel | **fait** — outils livres et epreuve de restauration jouee ; reste a brancher le planificateur et le disque hors site chez le client. Voir [`sauvegardes.md`](sauvegardes.md) |
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
| Import complet : 28 272 produits, 21 198 codes-barres, 1 735 packs, 450 vracs, 7 021 clients, 692 fournisseurs, sans perte | **eprouve sur le fichier reel** — tout est repris sauf 115 lignes porteuses d'erreurs a corriger par le client |
| Valeur du stock au CUMP et soldes tiers identiques a l'ancien logiciel | **controles identiques au centime pres** entre le fichier et la base ; reste a les comparer avec l'ancien logiciel |
| Une journee type (environ 430 tickets sur 2 caisses) rejouee sans erreur | **verifie** — 430 tickets et 2 780 lignes rejoues sur 30 015 articles |
| Coupure reseau de 2 heures : 100 % des tickets retrouves, sans doublon | **verifie** |
| Une carte cadeau acceptee par deux caisses pendant la meme coupure : les deux ventes tiennent, le solde ne passe pas en negatif, le manque est signale au centime | **verifie** — deux bases locales reelles et un serveur reel |
| Cloture Z avec comptage, ecart calcule et justifie | **verifie** |
| Un caissier sans droit ne peut ni annuler, ni modifier un prix, ni voir les marges | **verifie** |
| Consultation des ventes du jour depuis un smartphone hors du magasin | **verifie** en navigateur mobile ; reste a eprouver via le tunnel |
| Rapport mensuel rendu en moins de 5 secondes | **verifie au volume reel** — 27 ms pour la synthese, 159 ms pour les ruptures sur 30 000 articles, 176 ms pour la consolidation ; les exports Excel et PDF tiennent sous 210 ms |
| Transfert inter-magasins : ce qui part, ce qui arrive et l'ecart sont traces separement | **verifie** — le groupe ne perd que la quantite reellement manquante |
| Journaux comptables exportables au format du comptable | **verifie** — CSV relu ligne a ligne, totaux identiques a l'ecran au centime ; le format exact du cabinet reste a confirmer |
| Le depart d'un employe coupe ses acces | **verifie** — apres la sortie, ni son code PIN, ni son mot de passe, ni le jeton qu'il avait en cours ne donnent plus la main |
| Restauration complete depuis la sauvegarde de la veille en moins d'une heure | **verifie** — base detruite puis rebatie au volume reel : 30 015 articles et 7 718 tiers restaures en 1,4 s, chiffres identiques et chaine d'audit intacte |

---

## 4. Decisions qui vous appartiennent

Ces points ne peuvent pas etre tranches sans vous. Aucun n'empeche de
continuer, mais chacun changera du code s'il est tranche plus tard.

1. **Droit de timbre.** Le parametre existe (taux, minimum, maximum,
   arrondi, modes de reglement soumis) mais il est **desactive par
   defaut**. Les valeurs a retenir sont a confirmer avec votre comptable.

2. **Regime de TVA.** Presque tous les produits sont a TVA 0 dans
   l'export actuel. L'etat pour les declarations fonctionne et le
   signale a chaque edition, mais tant que le regime n'est pas
   confirme, les taux portes par le catalogue sont ceux de l'ancien
   logiciel : c'est a verifier avec votre comptable avant la premiere
   declaration faite avec GestGlobale.

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

8. **Taux de cotisations et d'impot sur le revenu.** Le bareme de paie
   est en place et parametrable, mais ses valeurs par defaut sont des
   valeurs plausibles, pas des valeurs verifiees. Avant la premiere
   paie faite avec GestGlobale, votre comptable doit confirmer : part
   salariale et part patronale des cotisations, tranches de l'IRG,
   majoration des heures supplementaires, et quelles primes sont
   exonerees. Dites-nous aussi si un ecart de caisse peut etre retenu
   sur un salaire : c'est desactive par defaut.

9. **Relais de messagerie pour le resume quotidien.** Le resume est
   produit et conserve chaque matin, mais il ne peut pas partir sans un
   relais : adresse du serveur, port, identifiants, adresse
   d'expedition. Faute de messagerie d'entreprise, deux solutions
   existent — un compte d'envoi chez votre fournisseur d'acces, ou un
   envoi par WhatsApp, qui demanderait un developpement supplementaire.
   Dites-nous aussi a quelle heure vous voulez le recevoir, et a quelles
   adresses.

---

## 5. Prochaines etapes proposees

1. Faire corriger par le client les 115 lignes bloquantes du rapport
   d'import, puis comparer les trois totaux avec l'ancien logiciel.
   Voir [`rapport-import-VENTES_2026.md`](rapport-import-VENTES_2026.md).
2. Executer l'installateur sur une vraie machine Windows, avec sa
   douchette, son imprimante et son tiroir. Voir
   [`installer-la-caisse.md`](installer-la-caisse.md).
3. Obtenir le relais de messagerie, pour que le resume quotidien parte
   vraiment et que les factures puissent etre envoyees sans intervention
   humaine. Les factures, bons de livraison, proformas et avoirs sont
   desormais fabriques en PDF par le serveur : il ne manque que le
   relais pour les joindre a un courriel.
4. Refaire le test de charge sur le serveur du client : le ProLiant
   ML330 G6 n'a pas de SSD et les durees y seront moins bonnes que dans
   l'environnement de developpement.
5. Brancher les sauvegardes chez le client : planificateur de taches,
   disque hors site, et mise au coffre de la phrase secrete. Les outils
   et l'epreuve de restauration sont livres — voir
   [`sauvegardes.md`](sauvegardes.md). Reste aussi le tunnel chiffre.
6. Pilote sur un magasin, formation des caissiers, puis bascule.
