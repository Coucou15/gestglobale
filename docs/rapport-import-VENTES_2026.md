# Rapport d'import a blanc — VENTES_2026.xls

Fichier recu le 20 novembre 2026, 14 Mo, analyse et importe en base reelle.

---

## 1. Le fichier

C'est un **vrai `.xls` binaire** (format OLE2, d'avant 2007), et non un
classeur `.xlsx`. L'assistant l'a reconnu et a demande la conversion
prevue ; elle a ete faite ici une fois pour toutes.

> Pour la bascule : ouvrez `VENTES_2026.xls` dans Excel, **Enregistrer
> sous** → **Classeur Excel (.xlsx)**. Une minute, une seule fois.

Les 12 onglets attendus sont presents. L'entete est en **ligne 2**, la
ligne 1 portant un titre : l'assistant le gere.

## 2. Ce qui a ete repris

| Onglet | Lignes lues | Retenues | Rejetees |
|---|---:|---:|---:|
| PRODUITS | 28 272 | **28 272** | 0 |
| GENERIQUES | 21 198 | 21 145 | 53 |
| PACKS | 1 734 | 1 704 | 30 |
| VRACS | 450 | **450** | 0 |
| CLIENTS | 7 021 | 7 020 | 1 |
| FOURNISSEURS | 692 | 661 | 31 |

Les volumes correspondent exactement au cahier des charges : 28 272
produits, 21 198 codes-barres, 1 735 packs, 450 vracs, 7 021 clients,
692 fournisseurs.

**24 545 articles ont un stock a zero** — le chiffre exact annonce. Ils
sont archives, donc consultables et historises, mais non vendables. Dites
si certaines familles doivent rester vendables malgre un stock nul.

## 3. Controles de bascule

L'import definitif a tourne sur une base reelle en **169 secondes**. Les
totaux relus depuis la base sont **identiques au centime pres** a ceux
calcules depuis le fichier :

| Controle | Fichier | Base | Ecart |
|---|---:|---:|---:|
| Articles | 28 272 | 28 272 | **0** |
| Codes-barres | 50 835 | 50 835 | **0** |
| Packs | 1 704 | 1 704 | **0** |
| Vracs | 450 | 450 | **0** |
| Clients | 7 020 | 7 020 | **0** |
| Fournisseurs | 661 | 661 | **0** |
| Valeur du stock au CUMP | 18 381 375,08 DA | 18 381 375,08 DA | **0** |
| Total soldes clients | 1 124 466,66 DA | 1 124 466,66 DA | **0** |
| Total soldes fournisseurs | 33 437 867,65 DA | 33 437 867,65 DA | **0** |

**Ces trois derniers montants sont a comparer avec ce qu'affiche l'ancien
logiciel.** S'ils different, le probleme est dans la lecture du fichier et
nous le corrigerons avant la bascule.

Un solde fournisseur de 33,4 millions de dinars represente environ 96
jours de chiffre d'affaires : confirmez qu'il correspond bien a vos
dettes fournisseurs reelles.

## 4. Ce que vous devez corriger avant la bascule

### Erreurs bloquantes — 115 lignes seraient perdues

| Nombre | Onglet | Probleme |
|---:|---|---|
| 53 | GENERIQUES | code-barres deja attribue a un autre article |
| 31 | FOURNISSEURS | deux fournisseurs differents portent le meme code |
| 30 | PACKS | le produit de base du pack n'existe pas dans PRODUITS |
| 1 | CLIENTS | deux clients portent le meme code |

Exemples reels :

- fournisseur : le code **24** designe a la fois la ligne 3 et
  « BRILEX DETERGENTS » ; le code **25** designe deux societes dont
  « GAUFRES » ; idem pour **26**, **45**, **52**, **15**...
- pack : le pack `3014683022393` renvoie au produit **150**, qui n'existe
  pas ; de meme **468**, **469**, **AC**, **30034679**.
- generique : le code `0580000044810` est deja le code-barres d'un autre
  article. Un code ne peut appartenir qu'a un seul article, sinon la
  caisse ne sait pas quoi vendre.

Un code-barres en double est le plus grave des quatre : il se traduit
directement par une erreur de prix en caisse.

### Avertissements — importes, mais a verifier

| Nombre | Probleme |
|---:|---|
| 177 | seuil d'alerte negatif, **remis a 0 automatiquement** |
| 174 | pack dont le produit de base n'a pas de prix « PACK » : il serait vendu a **zero dinar** |
| 137 | stock negatif, a corriger par un inventaire |
| 64 | cle de controle EAN-13 incorrecte (probablement des codes internes) |
| 22 | prix de vente sous le cout d'achat |
| 18 | code partage entre un client et un fournisseur (voir ci-dessous) |
| 10 | code de pack deja utilise comme code-barres |
| 5 | article sans designation |
| 2 | unite de mesure aberrante (« . ») |

Les **174 packs sans prix** meritent votre attention : ils passeraient en
caisse a zero dinar. C'est la meme famille de defaut que celui trouve en
essai, et il est reel dans vos donnees.

## 5. Deux decisions prises a votre place, a confirmer

### Les codes partages entre clients et fournisseurs

Votre logiciel tient **deux espaces de codes separes**. Le code « 15 »
designe le client *ABBOU YACINE* et le fournisseur *CLEAN TRUST*, qui
n'ont rien a voir. Dix-huit codes sont dans ce cas, et **aucun** ne
correspond a la meme societe des deux cotes.

GestGlobale reunit clients et fournisseurs dans une seule table, pour
qu'une seule recherche suffise et qu'une societe a la fois client et
fournisseur n'existe qu'une fois. J'ai donc **conserve le code du client**
et prefixe le fournisseur en conflit : « 15 » devient « F-15 ». Les 643
autres fournisseurs gardent leur code d'origine.

Dites si vous preferez l'inverse, ou une autre regle.

### Le sens de TYPE CLIENT

Le cahier des charges annonce « F / C / S → fidelite / client / interne ».
Les donnees disent autre chose : **6 995 « F »**, 21 « C », 5 « S ». Si
« F » designait la fidelite, il y en aurait 3 460, puisque c'est le nombre
de cartes.

J'ai donc retenu : **F = client de passage**, **C = compte
professionnel** (21 comptes), **S = magasin ou depot interne** (5). Les
3 460 cartes fidelite anonymes sont reconnues a leur raison sociale,
« CARTE FIDELITE », et non a ce code.

Cette lecture gouverne la categorie de prix appliquee en caisse :
**confirmez-la**, c'est la seule interpretation que je n'ai pas pu deduire
du fichier avec certitude.

## 6. L'historique repris

Les cinq onglets d'historique sont desormais importes et consultables
dans **Historique repris** du back-office : **2 642 lignes**.

| Onglet | Lignes reprises |
|---|---:|
| STOCKS | 1 752 |
| TRESORERIE | 450 |
| SORTIES | 432 |
| ENTREES | 6 |
| RASEES | 2 |

Chaque ligne conserve **toutes ses colonnes d'origine**, y compris celles
que GestGlobale n'exploite pas aujourd'hui : rien n'est perdu, et votre
comptable retrouve le detail exact d'un document ancien.

L'onglet DETAIL DES VENTES (1 722 lignes) n'est volontairement pas
importe : c'est une synthese que GestGlobale recalcule depuis les ventes.

### Pourquoi cet historique n'entre pas dans les stocks

Le stock repris des PRODUITS est celui constate **a la fin** de la
journee exportee, et l'onglet STOCKS contient les mouvements **de cette
meme journee**. Les rejouer dans le journal de stock compterait deux fois
la marchandise. De meme, l'export ne donne aucun solde d'ouverture de
tresorerie : rejouer ses 450 ecritures donnerait des soldes faux.

L'historique est donc consultable et cherchable, mais separe des journaux
vivants — ce que demande le cahier des charges : « historique consultable
(lecture seule) ».

L'onglet **RASEES**, repris lui aussi, confirme le defaut qui a motive le
projet :

| Date | Caisse | Recette comptable | Recette physique | Difference |
|---|---:|---:|---:|---:|
| 01/11/2026 | 2 | 72 170,96 DA | **0** | −72 170,96 DA |
| 01/11/2026 | 3 | 96 636,70 DA | **0** | −96 636,70 DA |

Le comptage n'etait pas saisi. Dans GestGlobale, la cloture sans comptage
par coupure est impossible.

**Rappel important** : ce fichier ne couvre qu'une journee, le 01/11/2026.
Pour reprendre un historique utile, il faut un export sur la periode
voulue, ou un acces direct a la base de l'ancien logiciel.

## 7. Ce que l'epreuve a corrige dans GestGlobale

Vos donnees reelles ont revele quatre defauts que les essais n'avaient pas
pu montrer :

1. **La colonne `PRIX APPLIQUE` des packs ne contient pas un prix** mais
   le nom d'une categorie — « PACK » ou « DETAIL ». Le prix vit sur la
   fiche du produit de base. L'assistant lisait un prix la ou il n'y en a
   pas : les 1 734 packs seraient tous passes a zero dinar.
2. **Il n'y a pas de colonne de code-barres dans PRODUITS** : la reference
   *est* le code-barres. L'assistant n'en reprenait aucun.
3. **Un code de pack peut etre deja le code-barres d'un article.**
   L'import s'arretait sur une erreur technique au lieu de le signaler.
4. **Les codes clients et fournisseurs peuvent se croiser.** Meme
   consequence.

Et deux defauts de mes propres controles : la valeur du stock etait
tronquee a la division, et les intitules de colonnes supposes
(`SEUIL`, `TELEPHONE`, `FAMILLE`) ne sont pas ceux de votre export
(`STOCK ALERTE (MC)`, `TELEPHONE 01`, `FAMILLE PRODUIT`).

## 8. La suite

1. Vous corrigez les **115 lignes bloquantes** dans le fichier.
2. Vous confirmez les **deux decisions** de la section 5.
3. Vous comparez les **trois totaux** de la section 3 avec l'ancien
   logiciel.
4. Nouvel import a blanc : il doit sortir sans erreur bloquante.
5. Import definitif le soir de la bascule, apres la derniere cloture de
   caisse de l'ancien logiciel.
