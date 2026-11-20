import { useState } from 'react';
import { caisse, type EtatSync, type UtilisateurCaisse } from './api';
import { Voyant } from './Application';

const COUPURES = [200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500];

function formater(centimes: number): string {
  return (centimes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' DA';
}

/** Ouverture avec fond de caisse compte par coupure (M4). */
export function OuvertureSession({
  utilisateur,
  etatSync,
  surOuverture,
  surDeconnexion,
}: {
  utilisateur: UtilisateurCaisse;
  etatSync: EtatSync | null;
  surOuverture: () => void;
  surDeconnexion: () => void;
}) {
  const [nombres, setNombres] = useState<Record<number, number>>({});
  const [erreur, setErreur] = useState<string | null>(null);

  const total = COUPURES.reduce((t, c) => t + c * (nombres[c] ?? 0), 0);

  const ouvrir = async () => {
    setErreur(null);
    try {
      await caisse().ouvrirSession(total);
      surOuverture();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="plein-ecran">
      <div className="bandeau">
        <span className="titre">Ouverture de caisse</span>
        <span className="espace" />
        <Voyant etat={etatSync} />
        <button onClick={surDeconnexion}>Quitter</button>
      </div>

      <div className="centre">
        <div className="carte" style={{ width: 'min(560px, 100%)' }}>
          <h2 style={{ marginTop: 0 }}>Fond de caisse</h2>
          <p className="discret">
            Comptez le fond remis a {utilisateur.nom}. Ce montant servira de base au calcul de
            l&apos;ecart a la cloture.
          </p>

          <table style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>Coupure</th>
                <th className="nombre">Nombre</th>
                <th className="nombre">Montant</th>
              </tr>
            </thead>
            <tbody>
              {COUPURES.map((coupure) => (
                <tr key={coupure}>
                  <td>{formater(coupure)}</td>
                  <td className="nombre" style={{ width: 140 }}>
                    <input
                      type="number"
                      min={0}
                      value={nombres[coupure] ?? ''}
                      onChange={(e) =>
                        setNombres((n) => ({
                          ...n,
                          [coupure]: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      style={{ textAlign: 'right', minHeight: 40, padding: 8 }}
                    />
                  </td>
                  <td className="nombre">{formater(coupure * (nombres[coupure] ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ligne-total grand">
            <span>Fond de caisse</span>
            <span>{formater(total)}</span>
          </div>

          {erreur && <div className="message erreur">{erreur}</div>}

          <button className="principal" style={{ width: '100%' }} onClick={() => void ouvrir()}>
            Ouvrir la session
          </button>
        </div>
      </div>
    </div>
  );
}
