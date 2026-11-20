import { PERMISSIONS_PAR_ROLE, type CodeRole, type Permission } from '@gestglobale/shared';

/**
 * Permissions effectives d'un utilisateur :
 *   permissions du role + droits ajoutes individuellement - droits retires.
 *
 * Cet ordre est volontaire : un retrait l'emporte toujours sur un ajout,
 * pour qu'un retrait explicite ne puisse jamais etre contourne.
 */
export function permissionsEffectives(utilisateur: {
  role: string;
  permissionsAjoutees?: unknown;
  permissionsRetirees?: unknown;
}): string[] {
  const duRole: Permission[] = PERMISSIONS_PAR_ROLE[utilisateur.role as CodeRole] ?? [];
  const ajoutees = listeDeJson(utilisateur.permissionsAjoutees);
  const retirees = new Set(listeDeJson(utilisateur.permissionsRetirees));

  const effectives = new Set<string>([...duRole, ...ajoutees]);
  for (const retiree of retirees) effectives.delete(retiree);
  return [...effectives];
}

function listeDeJson(valeur: unknown): string[] {
  if (Array.isArray(valeur)) return valeur.filter((v): v is string => typeof v === 'string');
  if (typeof valeur === 'string') {
    try {
      const analysee = JSON.parse(valeur);
      return Array.isArray(analysee) ? analysee.filter((v) => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Verifie qu'une plage horaire autorise la connexion a cet instant. */
export function horaireAutorise(
  plages: unknown,
  maintenant = new Date(),
): { autorise: boolean; message?: string } {
  if (!Array.isArray(plages) || plages.length === 0) return { autorise: true };

  const jour = maintenant.getDay();
  const minutes = maintenant.getHours() * 60 + maintenant.getMinutes();

  const duJour = plages.filter(
    (p): p is { jour: number; debut: string; fin: string } =>
      typeof p === 'object' && p !== null && (p as { jour: number }).jour === jour,
  );
  if (duJour.length === 0) {
    return { autorise: false, message: "Connexion non autorisee ce jour" };
  }

  for (const plage of duJour) {
    const debut = enMinutes(plage.debut);
    const fin = enMinutes(plage.fin);
    if (debut !== null && fin !== null && minutes >= debut && minutes <= fin) {
      return { autorise: true };
    }
  }
  return { autorise: false, message: 'Connexion hors des plages horaires autorisees' };
}

function enMinutes(heure: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(heure ?? '');
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
