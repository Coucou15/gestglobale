<#
.SYNOPSIS
    Installe le serveur central GestGlobale sous Windows.

.DESCRIPTION
    Fait, dans l'ordre, ce que decrit docs/installer-le-serveur.md :
    outils, projet, dependances, configuration, base, construction.

    Le script s'arrete a la premiere etape qui echoue, en disant
    laquelle. Il peut etre relance : il repart de ce qui est deja en
    place, sans rien detruire.

    AVERTISSEMENT — ce script n'a pas encore ete execute sur une vraie
    machine Windows. Il est ecrit d'apres le comportement documente de
    winget, Node et PostgreSQL. Si une etape echoue, le message dit
    laquelle : la suite du guide donne l'equivalent a la main.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\installateur\installer-serveur.ps1
#>

#Requires -Version 5.1

[CmdletBinding()]
param(
    # Dossier ou vit le projet.
    [string] $Dossier = (Split-Path -Parent $PSScriptRoot),

    # Mot de passe du compte PostgreSQL « postgres ».
    # Laisse vide : il est tire au hasard a l'installation, ou demande
    # si PostgreSQL est deja present.
    [string] $MotDePassePostgres = '',

    # Ne pose aucune question : pour une installation sans personne
    # devant l'ecran.
    [switch] $SansQuestion
)

$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------
# Affichage
# --------------------------------------------------------------------

$script:Etape = 0

function Ecrire-Etape {
    param([string] $Texte)
    $script:Etape++
    Write-Host ''
    Write-Host "[$script:Etape] $Texte" -ForegroundColor Cyan
}

function Ecrire-Info { param([string] $T) Write-Host "    $T" -ForegroundColor Gray }
function Ecrire-Bien { param([string] $T) Write-Host "    $T" -ForegroundColor Green }
function Ecrire-Alerte { param([string] $T) Write-Host "    $T" -ForegroundColor Yellow }

function Arreter {
    param([string] $Raison, [string] $QueFaire)
    Write-Host ''
    Write-Host "ECHEC : $Raison" -ForegroundColor Red
    if ($QueFaire) {
        Write-Host ''
        Write-Host "Que faire : $QueFaire" -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host 'Le guide complet : docs\installer-le-serveur.md' -ForegroundColor Gray
    exit 1
}

function Commande-Existe {
    param([string] $Nom)
    $null -ne (Get-Command $Nom -ErrorAction SilentlyContinue)
}

# Recharge le PATH : un programme installe a l'instant n'est pas
# trouvable sans cela, et le script croirait l'installation ratee.
function Recharger-Chemin {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $utilisateur = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$utilisateur"
}

function Administrateur {
    $identite = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $identite).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Secret-Au-Hasard {
    param([int] $Octets = 32)
    $tampon = New-Object byte[] $Octets
    $source = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $source.GetBytes($tampon) } finally { $source.Dispose() }
    ($tampon | ForEach-Object { $_.ToString('x2') }) -join ''
}

# --------------------------------------------------------------------

Write-Host ''
Write-Host '  GestGlobale — installation du serveur central' -ForegroundColor White
Write-Host '  ---------------------------------------------' -ForegroundColor DarkGray

Ecrire-Etape 'Verification de la machine'

if (-not (Administrateur)) {
    Arreter 'ce script doit tourner en tant qu administrateur.' `
        'Clic droit sur le menu Demarrer, « Terminal (administrateur) », puis relancez.'
}
Ecrire-Bien 'droits administrateur : oui'

if (-not (Commande-Existe 'winget')) {
    Arreter 'winget est introuvable sur cette machine.' `
        ('Installez Git, Node.js 20+ et PostgreSQL 14+ depuis leurs sites, ' +
         'puis relancez ce script : il sautera cette etape.')
}
Ecrire-Bien "winget : present"

# --------------------------------------------------------------------

Ecrire-Etape 'Outils : Git, Node.js, PostgreSQL'

function Installer-Paquet {
    param([string] $Identifiant, [string] $Nom, [string] $Commande, [string] $Arguments = '')

    if ($Commande -and (Commande-Existe $Commande)) {
        Ecrire-Bien "$Nom : deja installe"
        return $false
    }

    Ecrire-Info "installation de $Nom..."
    $parametres = @('install', '-e', '--id', $Identifiant,
                    '--accept-package-agreements', '--accept-source-agreements')
    if ($Arguments) { $parametres += @('--custom', $Arguments) }

    & winget @parametres | Out-Host
    # winget rend 0 en cas de succes ; -1978335189 signifie « deja
    # installe », ce qui n'est pas une erreur.
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
        Arreter "l installation de $Nom a echoue (code $LASTEXITCODE)." `
            "Installez $Nom a la main, puis relancez ce script."
    }
    Recharger-Chemin
    Ecrire-Bien "$Nom : installe"
    return $true
}

Installer-Paquet -Identifiant 'Git.Git' -Nom 'Git' -Commande 'git' | Out-Null
Installer-Paquet -Identifiant 'OpenJS.NodeJS.LTS' -Nom 'Node.js' -Commande 'node' | Out-Null

$postgresDejaLa = Commande-Existe 'psql'
if (-not $postgresDejaLa) {
    if (-not $MotDePassePostgres) {
        $MotDePassePostgres = Secret-Au-Hasard -Octets 12
        Ecrire-Info 'un mot de passe est tire au hasard pour le compte postgres'
    }
    # L'installateur d'EnterpriseDB accepte ces options en mode muet.
    $options = "--mode unattended --unattendedmodeui none " +
               "--superpassword `"$MotDePassePostgres`" --serverport 5432"
    Installer-Paquet -Identifiant 'PostgreSQL.PostgreSQL.16' -Nom 'PostgreSQL' `
        -Commande '' -Arguments $options | Out-Null
    Recharger-Chemin
} else {
    Ecrire-Bien 'PostgreSQL : deja installe'
    if (-not $MotDePassePostgres) {
        if ($SansQuestion) {
            Arreter 'PostgreSQL est deja installe mais son mot de passe n est pas connu.' `
                'Relancez avec -MotDePassePostgres "votre-mot-de-passe".'
        }
        $secret = Read-Host -AsSecureString `
            'Mot de passe du compte PostgreSQL « postgres »'
        $MotDePassePostgres = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret))
    }
}

if (-not (Commande-Existe 'node')) {
    Arreter 'Node.js reste introuvable apres installation.' `
        'Fermez cette fenetre, rouvrez un Terminal administrateur et relancez.'
}
$versionNode = (& node --version) -replace '^v', ''
if ([version]($versionNode -split '-')[0] -lt [version]'20.0.0') {
    Arreter "Node.js $versionNode est trop ancien (il en faut 20 ou plus)." `
        'Mettez Node.js a jour, puis relancez.'
}
Ecrire-Bien "Node.js $versionNode"

# --------------------------------------------------------------------

Ecrire-Etape 'pnpm'

if (-not (Commande-Existe 'pnpm')) {
    & corepack enable | Out-Host
    Recharger-Chemin
}
if (-not (Commande-Existe 'pnpm')) {
    Arreter 'pnpm reste introuvable apres « corepack enable ».' `
        'Fermez cette fenetre, rouvrez un Terminal administrateur et relancez.'
}
Ecrire-Bien "pnpm $((& pnpm --version))"

# --------------------------------------------------------------------

Ecrire-Etape "Projet dans $Dossier"

if (Test-Path (Join-Path $Dossier 'package.json')) {
    Ecrire-Bien 'projet deja present'
} else {
    Ecrire-Info 'recuperation depuis GitHub...'
    & git clone 'https://github.com/Coucou15/gestglobale' $Dossier | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Arreter 'la recuperation du projet a echoue.' `
            ('Si le depot est prive, connectez votre PC a votre compte GitHub, ' +
             'ou telechargez l archive ZIP depuis la page du depot et ' +
             "decompressez-la dans $Dossier.")
    }
    Ecrire-Bien 'projet recupere'
}

Set-Location $Dossier

# --------------------------------------------------------------------

Ecrire-Etape 'Dependances'

& pnpm install | Out-Host
if ($LASTEXITCODE -ne 0) { Arreter 'pnpm install a echoue.' 'Lisez le message ci-dessus.' }
Ecrire-Bien 'dependances installees'

# --------------------------------------------------------------------

Ecrire-Etape 'Configuration'

$cheminEnv = Join-Path $Dossier 'apps\api\.env'
if (Test-Path $cheminEnv) {
    Ecrire-Bien 'configuration deja en place, laissee telle quelle'
} else {
    $modele = Get-Content (Join-Path $Dossier 'apps\api\.env.example') -Raw

    # Des secrets tires au hasard : ceux de l'exemple sont publies dans
    # le depot, et qui les connait peut fabriquer un jeton valide.
    $modele = $modele -replace 'JWT_SECRET="[^"]*"', "JWT_SECRET=`"$(Secret-Au-Hasard)`""
    $modele = $modele -replace 'JWT_REFRESH_SECRET="[^"]*"', "JWT_REFRESH_SECRET=`"$(Secret-Au-Hasard)`""

    $urlBase = "postgresql://postgres:$MotDePassePostgres@localhost:5432/gestglobale?schema=public"
    $modele = $modele -replace 'DATABASE_URL="[^"]*"', "DATABASE_URL=`"$urlBase`""

    Set-Content -Path $cheminEnv -Value $modele -Encoding UTF8
    Ecrire-Bien 'configuration ecrite, avec des secrets tires au hasard'
}

# --------------------------------------------------------------------

Ecrire-Etape 'Base de donnees'

Set-Location (Join-Path $Dossier 'apps\api')

& npx prisma migrate deploy | Out-Host
if ($LASTEXITCODE -ne 0) {
    Arreter 'la creation de la base a echoue.' `
        ('Verifiez que PostgreSQL est demarre (services.msc) et que le mot de passe ' +
         'de DATABASE_URL, dans apps\api\.env, est le bon.')
}
Ecrire-Bien 'tables creees'

& pnpm seed | Out-Host
if ($LASTEXITCODE -ne 0) {
    Ecrire-Alerte 'le jeu de demonstration n a pas pu etre charge (la base est peut-etre deja remplie)'
} else {
    Ecrire-Bien 'jeu de demonstration en place'
}

# --------------------------------------------------------------------

Ecrire-Etape 'Construction'

Set-Location $Dossier
& pnpm build | Out-Host
if ($LASTEXITCODE -ne 0) { Arreter 'la construction a echoue.' 'Lisez le message ci-dessus.' }
Ecrire-Bien 'serveur et back-office construits'

# --------------------------------------------------------------------

Write-Host ''
Write-Host '  Installation terminee.' -ForegroundColor Green
Write-Host ''
Write-Host '  Pour demarrer, dans deux fenetres separees :' -ForegroundColor White
Write-Host ''
Write-Host "    cd $Dossier" -ForegroundColor Gray
Write-Host '    pnpm dev:api' -ForegroundColor Gray
Write-Host ''
Write-Host "    cd $Dossier" -ForegroundColor Gray
Write-Host '    pnpm dev:bo' -ForegroundColor Gray
Write-Host ''
Write-Host '  Puis ouvrez http://localhost:5173' -ForegroundColor White
Write-Host '  Identifiant « gerant », mot de passe « GestGlobale2026! »' -ForegroundColor White
Write-Host ''
Write-Host '  Ces identifiants sont ceux de la demonstration :' -ForegroundColor Yellow
Write-Host '  changez-les avant toute mise en service.' -ForegroundColor Yellow
Write-Host ''
