import { ForbiddenException } from '@nestjs/common';
import type { UtilisateurConnecte } from './droits.decorator';

/**
 * Cloisonnement par magasin : un utilisateur n'agit que sur les magasins
 * qui lui sont rattaches (section 6). Le gerant, rattache a tous les
 * magasins, passe naturellement ce controle.
 */
export function verifierAccesMagasin(utilisateur: UtilisateurConnecte, magasinId: string): void {
  if (!utilisateur.magasins.includes(magasinId)) {
    throw new ForbiddenException("Vous n'avez pas acces a ce magasin");
  }
}

/** Restreint un filtre de recherche aux magasins autorises. */
export function filtreMagasins(
  utilisateur: UtilisateurConnecte,
  magasinDemande?: string,
): { in: string[] } {
  if (magasinDemande) {
    verifierAccesMagasin(utilisateur, magasinDemande);
    return { in: [magasinDemande] };
  }
  return { in: utilisateur.magasins };
}
