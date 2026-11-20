import { useState } from 'react';
import { appeler, enregistrerSession, ErreurApi } from '../client';
import type { Utilisateur } from '../Application';

export function Connexion({ surConnexion }: { surConnexion: (u: Utilisateur) => void }) {
  const [login, setLogin] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [codeTotp, setCodeTotp] = useState('');
  const [demande2fa, setDemande2fa] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const valider = async () => {
    setErreur(null);
    setEnCours(true);
    try {
      const reponse = await appeler<{
        jeton: string; rafraichissement: string; utilisateur: Utilisateur;
      }>('/auth/connexion', {
        methode: 'POST',
        corps: { login, motDePasse, ...(codeTotp ? { codeTotp } : {}) },
        sansRenouvellement: true,
      });
      enregistrerSession(reponse.jeton, reponse.rafraichissement);
      surConnexion(reponse.utilisateur);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Depuis Internet, la double authentification est obligatoire.
      if (e instanceof ErreurApi && /double authentification/i.test(message)) {
        setDemande2fa(true);
      }
      setErreur(message);
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="centre">
      <div className="carte-connexion">
        <h1 style={{ marginTop: 0, fontSize: 22 }}>GestGlobale</h1>
        <p className="discret" style={{ marginTop: 0 }}>Back-office</p>

        <div className="champ">
          <label htmlFor="login">Identifiant</label>
          <input
            id="login" autoFocus autoComplete="username"
            value={login} onChange={(e) => setLogin(e.target.value)}
          />
        </div>

        <div className="champ">
          <label htmlFor="mdp">Mot de passe</label>
          <input
            id="mdp" type="password" autoComplete="current-password"
            value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !demande2fa && void valider()}
          />
        </div>

        {demande2fa && (
          <div className="champ">
            <label htmlFor="totp">Code de double authentification</label>
            <input
              id="totp" inputMode="numeric" maxLength={6} placeholder="000000"
              value={codeTotp} onChange={(e) => setCodeTotp(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && void valider()}
            />
          </div>
        )}

        {erreur && <div className="message erreur">{erreur}</div>}

        <button
          className="principal" style={{ width: '100%' }}
          disabled={enCours || !login || motDePasse.length < 8}
          onClick={() => void valider()}
        >
          {enCours ? 'Connexion...' : 'Se connecter'}
        </button>
      </div>
    </div>
  );
}
