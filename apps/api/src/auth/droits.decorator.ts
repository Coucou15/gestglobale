import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Permission } from '@gestglobale/shared';

export const CLE_DROITS = 'droits_requis';
export const CLE_PUBLIC = 'route_publique';

/** Exige une ou plusieurs permissions (toutes requises). */
export const Droits = (...permissions: Permission[]) => SetMetadata(CLE_DROITS, permissions);

/** Route accessible sans jeton (connexion, sante du serveur). */
export const Public = () => SetMetadata(CLE_PUBLIC, true);

export interface UtilisateurConnecte {
  id: string;
  code: string;
  nom: string;
  login: string;
  role: string;
  permissions: string[];
  magasins: string[];
  caisseId?: string | null;
  poste?: string | null;
  /** Vrai si la connexion vient d'Internet et non du reseau local. */
  depuisInternet: boolean;
}

/** Injecte l'utilisateur authentifie dans une methode de controleur. */
export const Utilisateur = createParamDecorator(
  (champ: keyof UtilisateurConnecte | undefined, contexte: ExecutionContext) => {
    const requete = contexte.switchToHttp().getRequest();
    const utilisateur = requete.utilisateur as UtilisateurConnecte;
    return champ ? utilisateur?.[champ] : utilisateur;
  },
);
