import { useEffect, useState } from 'react';
import { appeler } from '../client';

export interface Emplacement {
  id: string; code: string; nom: string; type: string;
  parDefautReception: boolean; parDefautVente: boolean;
}

export interface MagasinReferentiel {
  id: string; code: string; nom: string;
  emplacements: Emplacement[];
  caisses: Array<{ id: string; numero: number; libelle: string }>;
}

export interface CompteReferentiel {
  id: string; code: string; libelle: string; type: string; soldeCentimes: number;
}

/**
 * Charge une fois le referentiel dont les ecrans de saisie ont besoin.
 *
 * Les comptes de tresorerie ne sont demandes que si l'ecran en a besoin
 * ET que l'utilisateur y a droit : un magasinier n'a pas a declencher une
 * requete qui lui sera refusee.
 */
export function useReferentiel(options: { avecComptes?: boolean } = {}) {
  const [magasins, setMagasins] = useState<MagasinReferentiel[]>([]);
  const [comptes, setComptes] = useState<CompteReferentiel[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const m = await appeler<MagasinReferentiel[]>('/referentiel/magasins');
        if (!vivant) return;
        setMagasins(m);
        if (options.avecComptes) {
          const situation = await appeler<{ comptes: CompteReferentiel[] }>(
            '/tresorerie/situation',
          );
          if (vivant) setComptes(situation.comptes);
        }
      } catch (e) {
        if (vivant) setErreur(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivant) setPret(true);
      }
    })();
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.avecComptes]);

  return { magasins, comptes, erreur, pret };
}
