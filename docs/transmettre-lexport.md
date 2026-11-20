# Ce qu'il faut transmettre pour la migration

## 1. L'export de l'ancien logiciel — l'essentiel

Le fichier que le cahier des charges appelle `VENTES_2026.xls`, avec ses
12 onglets : PRODUITS, GENERIQUES, PACKS, VRACS, CLIENTS, FOURNISSEURS,
ENTREES, SORTIES, STOCKS, TRESORERIE, RASEES, DETAIL DES VENTES.

**Envoyez-le tel quel.** L'assistant reconnait le format par le contenu et
non par l'extension, et vous dit quoi faire s'il ne sait pas le lire :

| Ce que contient vraiment le fichier | Ce qui se passe |
|---|---|
| Classeur `.xlsx` (Excel 2007 et apres) | lu directement |
| Fichier texte `.csv` ou tabule | lu directement, un onglet |
| Vrai `.xls` binaire (avant 2007) | message indiquant la conversion a faire |
| Tableau HTML nomme `.xls` | idem — cas frequent des logiciels anciens |
| XML Excel 2003 | idem |

Dans les trois derniers cas, la conversion prend une minute et ne se fait
qu'une fois :

> Ouvrir le fichier dans Excel ou LibreOffice, puis **Enregistrer sous**,
> format **Classeur Excel (.xlsx)**.

Cette conversion est volontairement laissee a un outil bureautique plutot
qu'embarquee dans le serveur : lire le format binaire de 1997 demanderait
une dependance supplementaire, porteuse de failles connues, pour une
operation qui n'a lieu qu'une seule fois dans la vie du projet.

### Une precision sur le perimetre

Le fichier decrit dans le cahier des charges ne couvre **qu'une journee**
(01/11/2026). Les onglets ENTREES, SORTIES, STOCKS, TRESORERIE et RASEES
n'y portent donc qu'un historique d'un jour.

Si vous voulez reprendre l'historique complet, il faut soit un export sur
toute la periode souhaitee, soit un acces direct a la base de l'ancien
logiciel. Dites-moi ce que vous preferez : la profondeur d'historique
change la duree de la bascule, pas sa methode.

### Sur la confidentialite

Le fichier contient des noms de clients, des numeros de telephone et des
soldes. Il reste dans l'environnement de travail de cette session, qui est
efface a sa fermeture, et n'est envoye a aucun service tiers.

## 2. Trois reponses, si vous les avez

Elles ne bloquent pas la migration, mais elles seront figees dans les
documents que le logiciel imprime.

1. **Droit de timbre** — taux, minimum, maximum, et modes de reglement
   soumis. Aujourd'hui desactive par defaut, a confirmer avec votre
   comptable.
2. **Regime de TVA** — presque tous les produits sont a TVA 0 dans
   l'export. Est-ce exact ?
3. **Arrondi des especes** — un total de ticket tombe sur n'importe quel
   centime, la plus petite coupure vaut 5 DA. Faut-il arrondir le montant
   du en especes au multiple de 5 DA, ou laisser l'ecart apparaitre a la
   cloture comme aujourd'hui ?

## 3. Le serveur, quand vous y aurez acces

Les quatre points que le cahier des charges laisse ouverts, lisibles dans
le **Gestionnaire de serveur** ou l'outil HP :

- le processeur installe ;
- la quantite de memoire et le type de barrettes ;
- le type de controleur RAID et l'etat des disques ;
- la presence ou non d'un onduleur, et sa capacite.

## 4. Ce que j'en ferai

1. Import a blanc : rien n'est ecrit, et vous recevez le rapport des
   anomalies, onglet par onglet et ligne par ligne.
2. Vous corrigez dans le fichier ce qui doit l'etre.
3. Comparaison des controles de bascule — nombre d'articles, valeur du
   stock au CUMP, total des soldes clients et fournisseurs — avec ce
   qu'affiche l'ancien logiciel.
4. Import definitif, le soir de la bascule, apres la derniere cloture de
   caisse de l'ancien logiciel.
