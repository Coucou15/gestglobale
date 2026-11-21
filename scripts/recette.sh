#!/usr/bin/env bash
#
# Recette du lot 1 — rejoue les criteres de reception du cahier des charges
# contre un serveur reellement demarre et une base reellement ecrite.
#
# Chaque suite part d'une base fraiche : la numerotation des documents est
# deterministe par caisse (SV-03-000001...), donc rejouer une suite sur une
# base deja remplie ferait acquitter les documents comme « deja recus »,
# ce qui est le comportement attendu mais masquerait les verifications.
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$RACINE/apps/api"
POS="$RACINE/apps/pos"
PORT="${PORT:-3000}"
export API_BASE="${API_BASE:-http://localhost:$PORT/api/v1}"

JOURNAL="$(mktemp -t gestglobale-api-XXXXXX.log)"
PID_SERVEUR=""

couleur() { printf '\n\033[1m%s\033[0m\n' "$1"; }

arreter() {
  if [[ -n "$PID_SERVEUR" ]] && kill -0 "$PID_SERVEUR" 2>/dev/null; then
    kill "$PID_SERVEUR" 2>/dev/null || true
    wait "$PID_SERVEUR" 2>/dev/null || true
  fi
  PID_SERVEUR=""
}
trap arreter EXIT

# Un serveur laisse tourner d'une session de travail precedente servirait
# une base que la recette croit fraiche : les suites echoueraient pour une
# raison qui n'a rien a voir avec le code. On fait donc place nette.
liberer_le_port() {
  local restes
  restes="$(pgrep -f 'node dist/main.js' || true)"
  if [[ -n "$restes" ]]; then
    echo "  un serveur tournait deja : il est arrete"
    kill $restes 2>/dev/null || true
    sleep 1
  fi
}

base_fraiche() {
  arreter
  liberer_le_port
  ( cd "$API" && npx prisma migrate reset --force --skip-seed --skip-generate >/dev/null )
  ( cd "$API" && npx ts-node -T prisma/seed.ts >/dev/null )
  ( cd "$API" && node dist/main.js >"$JOURNAL" 2>&1 & echo $! > /tmp/gestglobale.pid )
  PID_SERVEUR="$(cat /tmp/gestglobale.pid)"

  for _ in $(seq 1 40); do
    if curl -sf -o /dev/null "http://localhost:$PORT/api/v1/auth/moi" \
      || curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/v1/auth/moi" \
         | grep -q 401; then
      return 0
    fi
    sleep 0.5
  done
  echo "Le serveur n'a pas demarre. Journal :" >&2
  tail -30 "$JOURNAL" >&2
  exit 1
}

liberer_le_port

couleur '1/7  Construction'
( cd "$RACINE/packages/shared" && pnpm build >/dev/null )
( cd "$API" && npx prisma generate >/dev/null && npx nest build >/dev/null )
# La caisse aussi : les etapes Electron lancent le code compile de
# dist/, pas les sources. Sans cette construction, la recette validait
# le dernier build en date et pouvait donc declarer bonne une version
# que personne n'avait ecrite.
( cd "$POS" && pnpm build >/dev/null )

couleur '2/7  Noyau metier (hors base, hors reseau)'
( cd "$RACINE/packages/shared" && npx vitest run )

couleur "3/7  Nettoyage a l'import de l'export de l'ancien logiciel"
( cd "$API" && npx vitest run )

couleur '4/7  Recette fonctionnelle du lot 1 (API + PostgreSQL)'
base_fraiche
( cd "$API" && node test/recette-lot1.mjs )

couleur '5/7  Coupure reseau de la caisse (SQLite local + API)'
base_fraiche
( cd "$POS" && npx vitest run )

# Les etapes Electron viennent APRES les essais sous Node, car elles
# recompilent la base locale pour l'interface binaire d'Electron : un
# seul binaire peut vivre dans build/Release. Celle de Node est
# retablie a la fin, meme en cas d'echec.
couleur '6/7  Modules natifs sous Electron'
if command -v xvfb-run >/dev/null 2>&1; then
  ( cd "$POS" && pnpm preparer >/dev/null 2>&1 )
  ( cd "$POS" && xvfb-run -a npx electron --no-sandbox outils/sonde-natif.js ) || ETAT_ELECTRON=1

  couleur '7/7  La caisse, de bout en bout sous Electron'
  base_fraiche
  ( cd "$POS" && xvfb-run -a npx electron --no-sandbox outils/essai-caisse.js ) || ETAT_ELECTRON=1

  ( cd "$POS" && pnpm restaurer >/dev/null 2>&1 )
  if [[ "${ETAT_ELECTRON:-0}" != "0" ]]; then
    echo 'ECHEC : la caisse ne passe pas sous Electron'
    exit 1
  fi
else
  echo '  ignore : xvfb absent, controle a refaire sur un poste avec affichage'
fi

if [[ "${AVEC_CHARGE:-0}" == "1" ]]; then
  couleur '8/8  Test de charge au volume reel'
  base_fraiche
  ( cd "$API" && npx ts-node -T prisma/seed-volume.ts )
  ( cd "$POS" && node test/charge.mjs )
  ( cd "$POS" && node test/concurrence.mjs )
fi

couleur 'Recette terminee.'
