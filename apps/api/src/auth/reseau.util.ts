/**
 * Distingue une connexion du reseau local d'une connexion venue d'Internet.
 * La double authentification n'est exigee que pour la seconde (section 6).
 */

function ipVersEntier(ip: string): number | null {
  const parties = ip.split('.');
  if (parties.length !== 4) return null;
  let valeur = 0;
  for (const partie of parties) {
    const n = Number(partie);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    valeur = valeur * 256 + n;
  }
  return valeur;
}

export function adresseDansCidr(ip: string, cidr: string): boolean {
  const [base, bitsTexte] = cidr.trim().split('/');
  const bits = Number(bitsTexte ?? 32);
  const valeurIp = ipVersEntier(normaliser(ip));
  const valeurBase = ipVersEntier(base);
  if (valeurIp === null || valeurBase === null || !Number.isInteger(bits)) return false;
  if (bits <= 0) return true;
  if (bits > 32) return false;
  const masque = bits === 32 ? 0xffffffff : ~((1 << (32 - bits)) - 1) >>> 0;
  return (valeurIp & masque) === (valeurBase & masque);
}

/** Retire le prefixe IPv6-mappe "::ffff:" des adresses remontees par Node. */
export function normaliser(ip: string): string {
  if (!ip) return '';
  if (ip === '::1') return '127.0.0.1';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function estReseauLocal(ip: string, cidrs: string[]): boolean {
  const propre = normaliser(ip);
  return cidrs.some((cidr) => adresseDansCidr(propre, cidr));
}
