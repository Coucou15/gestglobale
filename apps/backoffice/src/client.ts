/**
 * Client de l'API.
 *
 * Il porte le jeton, le renouvelle silencieusement quand il expire, et
 * deconnecte apres 15 minutes d'inactivite, comme l'exige la section 6.
 */
const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';
const CLE_JETON = 'gestglobale.jeton';
const CLE_RAFRAICHISSEMENT = 'gestglobale.rafraichissement';
const INACTIVITE_MS = 15 * 60 * 1000;

let dernierGeste = Date.now();
['click', 'keydown', 'touchstart', 'mousemove'].forEach((evenement) =>
  window.addEventListener(evenement, () => { dernierGeste = Date.now(); }, { passive: true }),
);

export function inactifTropLongtemps(): boolean {
  return Date.now() - dernierGeste > INACTIVITE_MS;
}

export function jeton(): string | null {
  return sessionStorage.getItem(CLE_JETON);
}

export function enregistrerSession(jetonAcces: string, rafraichissement: string): void {
  sessionStorage.setItem(CLE_JETON, jetonAcces);
  sessionStorage.setItem(CLE_RAFRAICHISSEMENT, rafraichissement);
  dernierGeste = Date.now();
}

export function effacerSession(): void {
  sessionStorage.removeItem(CLE_JETON);
  sessionStorage.removeItem(CLE_RAFRAICHISSEMENT);
}

export class ErreurApi extends Error {
  constructor(public readonly statut: number, message: string) {
    super(message);
  }
}

async function renouveler(): Promise<boolean> {
  const rafraichissement = sessionStorage.getItem(CLE_RAFRAICHISSEMENT);
  if (!rafraichissement) return false;
  try {
    const reponse = await fetch(`${BASE}/auth/rafraichir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rafraichissement }),
    });
    if (!reponse.ok) return false;
    const donnees = await reponse.json();
    enregistrerSession(donnees.jeton, donnees.rafraichissement);
    return true;
  } catch {
    return false;
  }
}

export async function appeler<T>(
  chemin: string,
  options: { methode?: string; corps?: unknown; sansRenouvellement?: boolean } = {},
): Promise<T> {
  if (inactifTropLongtemps()) {
    effacerSession();
    throw new ErreurApi(401, 'Session expiree apres 15 minutes sans activite');
  }

  const executer = async (): Promise<Response> =>
    fetch(`${BASE}${chemin}`, {
      method: options.methode ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(jeton() ? { Authorization: `Bearer ${jeton()}` } : {}),
      },
      ...(options.corps !== undefined ? { body: JSON.stringify(options.corps) } : {}),
    });

  let reponse = await executer();

  if (reponse.status === 401 && !options.sansRenouvellement && (await renouveler())) {
    reponse = await executer();
  }

  if (!reponse.ok) {
    let message = `Erreur ${reponse.status}`;
    try {
      const corps = await reponse.json();
      message = Array.isArray(corps.message) ? corps.message.join(', ') : corps.message ?? message;
    } catch {
      // Reponse sans corps JSON : on garde le message par defaut.
    }
    if (reponse.status === 401) effacerSession();
    throw new ErreurApi(reponse.status, message);
  }

  return (await reponse.json()) as T;
}

/**
 * Ouvre un document a imprimer dans un nouvel onglet.
 *
 * Le document est servi par une route protegee : un simple `window.open`
 * n'enverrait aucun jeton et recevrait un refus. On le recupere donc avec
 * l'en-tete d'authentification, puis on l'ouvre depuis la memoire du
 * navigateur. Le document etant autonome — styles compris — il s'affiche
 * et s'imprime sans rien aller rechercher.
 */
export async function ouvrirImpression(chemin: string): Promise<void> {
  const reponse = await fetch(`${BASE}${chemin}`, {
    headers: { ...(jeton() ? { Authorization: `Bearer ${jeton()}` } : {}) },
  });
  if (!reponse.ok) {
    throw new ErreurApi(reponse.status, `Impression impossible (erreur ${reponse.status})`);
  }
  const html = await reponse.text();
  const adresse = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const onglet = window.open(adresse, '_blank');
  if (!onglet) {
    URL.revokeObjectURL(adresse);
    throw new Error(
      'Le navigateur a bloque la fenetre d\u2019impression : autorisez les fenetres surgissantes.',
    );
  }
  // L'adresse temporaire est liberee une fois l'onglet charge.
  window.setTimeout(() => URL.revokeObjectURL(adresse), 60000);
}

export function formaterDA(centimes: number | undefined | null): string {
  const valeur = (centimes ?? 0) / 100;
  return valeur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DA';
}

export function formaterQuantite(milli: number, decimales = 0): string {
  return (milli / 1000).toFixed(decimales).replace('.', ',');
}

export function formaterDate(valeur: string | Date | null | undefined): string {
  if (!valeur) return '—';
  const d = typeof valeur === 'string' ? new Date(valeur) : valeur;
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
