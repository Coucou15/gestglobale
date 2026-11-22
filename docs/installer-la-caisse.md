# Installer une caisse

Procedure pour le technicien qui met en service un poste de caisse.

---

## 1. Ce qu'il faut sur le poste

| Element | Exigence |
|---|---|
| Systeme | Windows 10 ou 11, 64 bits |
| Memoire | 4 Go minimum |
| Reseau | acces au serveur central du magasin |
| Materiel | douchette USB, imprimante thermique 80 mm, tiroir-caisse |

La caisse n'a besoin ni de .NET, ni de Java, ni de base de donnees : tout
est dans l'installateur.

## 2. Fabriquer l'installateur

L'installateur Windows se construit **sur une machine Windows**, ou sur
Linux avec Wine. Depuis la racine du depot :

```bash
pnpm install
```

```bash
pnpm --filter @gestglobale/pos preparer
```

Cette etape recompile la base locale SQLite pour la version d'Electron
employee. Elle est **obligatoire** : un module compile pour Node ne se
charge pas dans Electron, et la caisse s'arreterait au demarrage.

```bash
pnpm --filter @gestglobale/pos empaqueter:windows
```

L'installateur apparait dans `apps/pos/release`. Comptez environ 190 Mo :
14 Mo d'application et le reste de moteur Electron.

### Verifier avant de diffuser

```bash
pnpm --filter @gestglobale/pos sonde
```

Controle que la base locale et le chiffrement des PIN se chargent bien
sous Electron. Si cette sonde echoue, l'installateur ne demarrera sur
aucun poste : reprenez l'etape `preparer`.

## 3. Installer le poste

L'installateur s'execute avec un compte administrateur. Il propose le
dossier d'installation, cree un raccourci sur le bureau et une entree au
menu Demarrer.

**La desinstallation ne supprime jamais les donnees du poste.** La base
locale peut contenir des tickets qui n'ont pas encore rejoint le serveur.

## 4. Mettre le poste en service

Au premier lancement, la caisse affiche son **ecran d'installation**. Rien
n'est a editer a la main.

1. **Adresse du serveur central** — par exemple
   `http://192.168.1.10:3000/api/v1`. Le bouton *Tester la connexion* le
   joint avant d'aller plus loin.
2. **Code du magasin et numero de caisse** — tels qu'ils sont declares au
   serveur. Le numero doit etre unique dans le magasin : il entre dans le
   numero de chaque ticket (`SV-03-000125`) et garantit qu'aucun doublon
   n'arrive au serveur, meme apres une coupure.
3. **En-tete des tickets** — raison sociale, adresse, RC, NIF, NIS et
   article d'imposition, imprimes sur chaque ticket.
4. **Imprimante** — le port du peripherique, par exemple `\\.\COM3`.
   Laissez vide pour ne pas imprimer : la caisse vend quand meme et les
   tickets restent reimprimables.

Puis un caissier prend son poste avec son code et son PIN.

> **La toute premiere connexion exige que le serveur soit joignable.**
> C'est elle qui rapporte le catalogue, les prix, les clients et les
> droits. Ensuite seulement la caisse sait vendre sans reseau.

## 5. Verifier que le poste est bon

- un article scanne apparait en moins de 0,3 seconde ;
- le voyant est **vert** en haut a droite ;
- une vente d'essai s'encaisse et s'imprime ;
- debranchez le cable reseau : le voyant passe a l'**orange**, la vente
  continue ;
- rebranchez : le voyant repasse au vert et les tickets en attente
  remontent seuls.

## 6. Mettre a jour une caisse

Relancez l'installateur de la nouvelle version. La configuration du poste
et la base locale sont conservees. Une caisse peut etre mise a jour
pendant que les autres vendent.

Ne mettez pas a jour une caisse dont le voyant est orange ou rouge :
videz d'abord sa file d'envoi en retablissant le reseau.

## 7. Ou vivent les donnees du poste

```
%APPDATA%\GestGlobale Caisse\caisse.json
%APPDATA%\GestGlobale Caisse\donnees\caisse.db
```

Le premier est la configuration, le second la base locale : catalogue
descendu, tickets du jour et file d'envoi. **Ce fichier contient des
ventes qui peuvent ne pas etre encore remontees** : ne le supprimez
jamais pour « repartir propre » sans avoir verifie que le voyant est
vert.

## 8. Ce qui reste a faire avant une diffusion large

- **Signature du code.** L'installateur n'est pas signe : Windows
  SmartScreen affichera un avertissement au premier lancement. Une
  signature exige un certificat au nom du client, a acquerir aupres
  d'une autorite de certification.
- **Icone.** Le dossier `apps/pos/ressources` est vide : l'application
  porte pour l'instant l'icone par defaut d'Electron. Deposez-y
  `icon.ico` (256x256) pour y remedier.
- **Essai sur Windows.** L'empaquetage a ete valide sur Linux, et
  l'application elle-meme eprouvee de bout en bout sous Electron :
  installation d'un poste neuf, descente du catalogue, prise de poste,
  vente, impression, remontee. **L'installateur Windows lui-meme n'a pas
  encore ete execute sur une machine Windows** : c'est la premiere chose
  a faire sur le poste pilote.

---

## Apres une mise a jour qui change la base

Appliquer une migration pendant que le serveur tourne peut le laisser
avec des plans de requete perimes : PostgreSQL rend alors
« cached plan must not change result type » sur les ecritures qui
touchent une table modifiee, jusqu'au prochain redemarrage.

La regle est donc simple, et l'installeur Windows la suit :

1. arreter le service GestGlobale ;
2. appliquer les migrations ;
3. redemarrer le service.

Les caisses n'ont rien a faire : elles continuent de vendre hors ligne
pendant l'operation et remontent leurs tickets au retour du serveur.
