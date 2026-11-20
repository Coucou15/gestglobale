import { useCallback, useEffect, useState } from 'react';
import { caisse, type EtatSync, type UtilisateurCaisse } from './api';
import { Connexion } from './Connexion';
import { OuvertureSession } from './OuvertureSession';
import { EcranVente } from './EcranVente';
import { Cloture } from './Cloture';

export function Application() {
  const [utilisateur, setUtilisateur] = useState<UtilisateurCaisse | null>(null);
  const [plafondRemise, setPlafondRemise] = useState(0);
  const [session, setSession] = useState<{ numero: string } | null>(null);
  const [etatSync, setEtatSync] = useState<EtatSync | null>(null);
  const [cloture, setCloture] = useState(false);

  const rafraichirSession = useCallback(async () => {
    setSession(await caisse().sessionCourante());
  }, []);

  useEffect(() => {
    void caisse().etatSync().then(setEtatSync);
    const arreter = caisse().surEtatSync(setEtatSync);
    return arreter;
  }, []);

  useEffect(() => {
    if (utilisateur) void rafraichirSession();
  }, [utilisateur, rafraichirSession]);

  if (!utilisateur) {
    return (
      <Connexion
        etatSync={etatSync}
        surConnexion={(u, plafond) => {
          setUtilisateur(u);
          setPlafondRemise(plafond);
        }}
      />
    );
  }

  if (!session) {
    return (
      <OuvertureSession
        utilisateur={utilisateur}
        etatSync={etatSync}
        surOuverture={rafraichirSession}
        surDeconnexion={() => setUtilisateur(null)}
      />
    );
  }

  if (cloture) {
    return (
      <Cloture
        session={session}
        surTermine={async () => {
          setCloture(false);
          await rafraichirSession();
        }}
        surAnnuler={() => setCloture(false)}
      />
    );
  }

  return (
    <EcranVente
      utilisateur={utilisateur}
      plafondRemise={plafondRemise}
      session={session}
      etatSync={etatSync}
      surCloture={() => setCloture(true)}
      surDeconnexion={() => setUtilisateur(null)}
    />
  );
}

export function Voyant({ etat }: { etat: EtatSync | null }) {
  if (!etat) return null;
  return (
    <span className="voyant" title={etat.message}>
      <span className={`pastille ${etat.couleur}`} />
      {etat.couleur === 'vert'
        ? 'En ligne'
        : `${etat.couleur === 'rouge' ? 'Hors ligne depuis plus de 24 h' : 'Hors ligne'} — ${etat.enAttente} en attente`}
    </span>
  );
}
