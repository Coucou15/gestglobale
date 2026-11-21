# Le resume quotidien du gerant

Chaque matin, GestGlobale calcule la journee de la veille et l'envoie au
gerant : recette, marge, tickets, panier moyen, reglements, heure la plus
forte, puis les points de vigilance — clotures manquantes, ecarts de
caisse, ecarts restes sans motif, annulations, ventes a perte, ruptures.

Le resume est **toujours produit et conserve**, meme quand l'envoi est
impossible. Le gerant le retrouve dans le back-office, rubrique
**Rapports**, onglet **Resumes quotidiens** — avec, le cas echeant, la
raison pour laquelle il n'est pas parti.

C'est deliberé. L'ancien logiciel produisait des chiffres qui
n'arrivaient nulle part ; ici, meme sans messagerie, ils existent et
sont lisibles.

---

## Ce qu'il faut nous fournir

L'envoi automatique a besoin d'un relais de messagerie. Il n'y en a pas
par defaut : GestGlobale n'invente pas de compte d'envoi.

Il nous faut :

| Element | Exemple | Remarque |
|---|---|---|
| Adresse du serveur | `smtp.votre-fai.dz` | fourni par votre fournisseur d'acces ou votre hebergeur |
| Port | `587` | `465` si la liaison est chiffree de bout en bout |
| Identifiant | `gestglobale@votre-domaine.dz` | |
| Mot de passe | — | ne nous l'envoyez pas par courriel ; saisissez-le a l'installation |
| Adresse d'expedition | `gestglobale@votre-domaine.dz` | ce que verra le destinataire |
| Heure d'envoi | `7` | heure locale, de 0 a 23 |
| Destinataires | `gerant@...` | sinon, les adresses des comptes « gerant » du magasin sont utilisees |

Si vous n'avez pas de messagerie d'entreprise, deux voies :

- **Un compte d'envoi chez votre fournisseur d'acces.** C'est le plus
  simple et cela ne demande aucun developpement.
- **WhatsApp.** C'est ce que beaucoup de commerces utilisent reellement.
  Cela demande un developpement supplementaire et un compte WhatsApp
  Business ; dites-le-nous si vous le preferez.

---

## Le reglage, cote technique

Le reglage vit dans le parametre `rapports.resumeQuotidien`, global ou
par magasin — un magasin peut vouloir son resume a une autre heure.

```json
{
  "actif": true,
  "heure": 7,
  "hote": "smtp.votre-fai.dz",
  "port": 587,
  "securise": false,
  "utilisateur": "gestglobale@votre-domaine.dz",
  "motDePasse": "...",
  "expediteur": "gestglobale@votre-domaine.dz",
  "destinataires": ["gerant@votre-domaine.dz"]
}
```

Tant que `actif` vaut `false`, rien n'est envoye et le resume reste
consultable dans le back-office.

Le mot de passe n'est **jamais** renvoye par l'API : l'ecran des
reglages indique seulement s'il est enregistre.

---

## Verifier sans attendre le lendemain

Dans le back-office, rubrique **Rapports**, onglet **Resumes
quotidiens**, le bouton **« Produire le resume d'hier »** declenche tout
le traitement immediatement, envoi compris. C'est ce qu'il faut utiliser
a l'installation pour eprouver le relais, et pour rattraper une journee
dont le resume aurait echoue.

Reproduire le resume d'un jour deja traite ne cree pas de doublon : il
est mis a jour.

---

## Ce qui se passe si le relais tombe

Rien de grave, et surtout rien de silencieux :

- la journee est calculee et conservee comme d'habitude ;
- l'erreur exacte est consignee sur le resume et affichee dans le
  back-office ;
- la journee suivante est traitee normalement. Un serveur de messagerie
  en panne ne fait pas taire le rapport du lendemain.

Un magasin en echec n'empeche pas les autres : chacun est traite
separement.
