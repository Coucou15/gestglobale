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

base_fraiche() {
  arreter
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

couleur '1/5  Construction'
( cd "$RACINE/packages/shared" && pnpm build >/dev/null )
( cd "$API" && npx prisma generate >/dev/null && npx nest build >/dev/null )

couleur '2/5  Noyau metier (hors base, hors reseau)'
( cd "$RACINE/packages/shared" && npx vitest run )

couleur '3/5  Nettoyage a l'import de l'export de l'ancien logiciel'
( cd "$API" && npx vitest run )

couleur '4/5  Recette fonctionnelle du lot 1 (API + PostgreSQL)'
base_fraiche
( cd "$API" && node test/recette-lot1.mjs )

couleur '5/5  Coupure reseau de la caisse (SQLite local + API)'
base_fraiche
( cd "$POS" && npx vitest run )

couleur 'Recette du lot 1 terminee.'
