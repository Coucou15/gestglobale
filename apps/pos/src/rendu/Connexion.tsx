import { useState } from 'react';
import { caisse, type EtatSync, type UtilisateurCaisse } from './api';
import { Voyant } from './Application';

/**
 * Connexion par code et PIN (section 6).
 * Fonctionne hors ligne : l'empreinte du PIN est descendue avec les droits.
 */
export function Connexion({
  etatSync,
  surConnexion,
}: {
  etatSync: EtatSync | null;
  surConnexion: (utilisateur: UtilisateurCaisse, plafondRemise: number) => void;
}) {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const valider = async () => {
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await caisse().connexion(code.trim(), pin);
      if (resultat.ok) surConnexion(resultat.utilisateur, resultat.plafondRemise);
      else setErreur(resultat.message);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
      setPin('');
    }
  };

  const touche = (chiffre: string) => {
    if (chiffre === 'C') setPin('');
    else if (chiffre === '<') setPin((p) => p.slice(0, -1));
    else setPin((p) => (p.length < 12 ? p + chiffre : p));
  };

  return (
    <div className="plein-ecran">
      <div className="bandeau">
        <span className="titre">GestGlobale — Caisse</span>
        <span className="espace" />
        <Voyant etat={etatSync} />
      </div>

      <div className="centre">
        <div className="carte">
          <h2 style={{ marginTop: 0 }}>Prise de poste</h2>

          <div className="champ">
            <label htmlFor="code">Code caissier</label>
            <input
              id="code"
              value={code}
              autoFocus
              inputMode="numeric"
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && document.getElementById('pin')?.focus()}
            />
          </div>

          <div className="champ">
            <label htmlFor="pin">Code PIN</label>
            <input
              id="pin"
              type="password"
              value={pin}
              inputMode="numeric"
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void valider()}
            />
          </div>

          <div className="pave" style={{ marginBottom: 14 }}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '<'].map((t) => (
              <button key={t} onClick={() => touche(t)}>
                {t}
              </button>
            ))}
          </div>

          {erreur && <div className="message erreur">{erreur}</div>}

          <button
            className="principal"
            style={{ width: '100%' }}
            disabled={enCours || code.length === 0 || pin.length < 4}
            onClick={() => void valider()}
          >
            {enCours ? 'Verification...' : 'Ouvrir la caisse'}
          </button>

          {etatSync?.couleur !== 'vert' && (
            <p className="discret" style={{ marginTop: 14 }}>
              La caisse fonctionne sans reseau : vous pouvez prendre votre poste et vendre
              normalement.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
