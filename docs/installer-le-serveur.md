# Installer le serveur GestGlobale sous Windows

Le serveur central porte la base de donnees, l'API et le back-office.
Les caisses s'y connectent ; elles ont leur propre installateur, decrit
dans [`installer-la-caisse.md`](installer-la-caisse.md).

Deux chemins : le script, ou les etapes a la main. Le script fait
exactement ce que decrivent les etapes, dans le meme ordre.

---

## 1. Ce qu'il faut sur la machine

| Element | Version | Pourquoi |
|---|---|---|
| Windows | 10, 11 ou Server 2016+ | `winget` doit etre present |
| Node.js | 20 ou plus | fait tourner le serveur |
| PostgreSQL | 14 ou plus | la base centrale |
| Git | n'importe laquelle | recupere le projet (facultatif : une archive ZIP suffit) |

Comptez 2 Go d'espace libre. Sur le serveur du magasin, verifiez
d'abord l'etat des disques : une machine de cet age peut avoir un
disque fatigue, et c'est le moment de le decouvrir, pas plus tard.

---

## 2. Le chemin rapide : le script

Ouvrez **PowerShell en tant qu'administrateur** — clic droit sur le
menu Demarrer, « Terminal (administrateur) » — puis :

```powershell
cd C:\GestGlobale
```

```powershell
powershell -ExecutionPolicy Bypass -File .\installateur\installer-serveur.ps1
```

Le script annonce chaque etape et s'arrete a la premiere qui echoue,
en disant laquelle. Il peut etre relance autant de fois que necessaire :
il repart de ce qui est deja en place.

A la fin, il ouvre le back-office dans votre navigateur.

---

## 3. Le chemin manuel, etape par etape

### 3.1 Installer les outils

```powershell
winget install -e --id Git.Git
```

```powershell
winget install -e --id OpenJS.NodeJS.LTS
```

```powershell
winget install -e --id PostgreSQL.PostgreSQL.16
```

L'installateur de PostgreSQL demande un **mot de passe pour le compte
`postgres`**. Notez-le : il entrera dans la configuration, et vous en
aurez besoin pour les sauvegardes.

Fermez puis rouvrez PowerShell, pour que les nouveaux programmes soient
trouves.

### 3.2 Activer pnpm

```powershell
corepack enable
```

### 3.3 Recuperer le projet

```powershell
git clone https://github.com/Coucou15/gestglobale C:\GestGlobale
```

Sans Git : telechargez l'archive depuis la page du depot
(**Code → Download ZIP**) et decompressez-la dans `C:\GestGlobale`.

### 3.4 Installer les dependances

```powershell
cd C:\GestGlobale
```

```powershell
pnpm install
```

### 3.5 Configurer

Copiez `apps\api\.env.example` vers `apps\api\.env`, puis ouvrez-le et
renseignez :

- `DATABASE_URL` — remplacez le mot de passe par celui choisi en 3.1 ;
- `JWT_SECRET` et `JWT_REFRESH_SECRET` — **deux valeurs differentes**,
  tirees au hasard. Pour en produire une :

```powershell
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
($b | ForEach-Object { $_.ToString('x2') }) -join ''
```

Ne laissez jamais les valeurs d'exemple : elles sont publiees dans le
depot, et qui les connait peut fabriquer un jeton valide.

### 3.6 Creer la base

D'abord la base elle-meme. `prisma migrate deploy` cree les tables
dans une base existante, mais ne cree pas la base : sur une machine
neuve, seule `postgres` existe. `psql` n'est pas dans le PATH apres
l'installation de PostgreSQL, d'ou le chemin complet (ajustez le
numero de version) :

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE gestglobale"
```

Il demande le mot de passe choisi en 3.1. Ensuite les tables :

```powershell
cd C:\GestGlobale\apps\api
```

```powershell
npx prisma migrate deploy
```

```powershell
pnpm seed
```

Le jeu de donnees de demonstration est alors en place.

Si une de ces deux commandes se plaint que « @prisma/client did not
initialize yet », c'est que le client Prisma n'a pas ete genere :

```powershell
npx prisma generate
```

puis reprenez. `pnpm install` le fait normalement tout seul. **Pour une
vraie installation**, c'est ici qu'on importe l'export de l'ancien
logiciel a la place — voir l'ecran « Import » du back-office.

### 3.7 Construire et demarrer

```powershell
cd C:\GestGlobale
```

```powershell
pnpm build
```

```powershell
pnpm dev:api
```

Dans une seconde fenetre :

```powershell
pnpm dev:bo
```

Le back-office repond sur **http://localhost:5173**.

---

## 4. Premiere connexion

Identifiant `gerant`, mot de passe `GestGlobale2026!`.

**Changez-le avant toute mise en service.** Ces identifiants sont ceux
de la demonstration, ils sont ecrits dans le depot, et le jeu de
donnees le rappelle a chaque execution.

---

## 5. En faire un service qui demarre tout seul

Tant que vous lancez `pnpm dev:api` a la main, le serveur s'arrete
quand vous fermez la fenetre. Sur le serveur du magasin, il doit
redemarrer avec la machine.

```powershell
npm install -g node-windows
```

Puis enregistrez le service depuis `installateur\service.js`. Le
back-office, lui, se construit une fois (`pnpm build`) et se sert comme
des fichiers statiques — il n'a pas besoin de tourner en permanence.

---

## 6. Apres une mise a jour qui change la base

Arretez le service, appliquez les migrations, redemarrez le service.
Appliquer une migration sous un serveur en marche le laisse avec des
plans de requete perimes — voir [`installer-la-caisse.md`](installer-la-caisse.md).

---

## 7. Quand quelque chose ne va pas

| Symptome | Cause la plus frequente |
|---|---|
| `winget` inconnu | Windows trop ancien : installez les outils depuis leur site |
| `pnpm` inconnu apres `corepack enable` | rouvrez PowerShell |
| `P1001: Can't reach database server` | PostgreSQL n'est pas demarre, ou le mot de passe de `DATABASE_URL` est faux |
| `EADDRINUSE :3000` | un autre programme occupe le port : changez `PORT` dans `.env` |
| Le navigateur n'affiche rien sur 5173 | `pnpm dev:bo` n'est pas lance, ou tourne dans une fenetre fermee |

Si un message d'erreur vous arrete, copiez-le tel quel : il dit
presque toujours ce qui manque.
