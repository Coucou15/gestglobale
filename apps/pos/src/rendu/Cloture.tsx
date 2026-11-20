import { useEffect, useState } from 'react';
import { caisse } from './api';

const COUPURES = [200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500];

function formater(centimes: number): string {
  return (centimes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 });
}

/**
 * Cloture Z.
 *
 * Le comptage par coupure est obligatoire et l'ecart s'affiche avant
 * validation : c'est ce qui empeche la derive de l'ancien logiciel, ou la
 * recette physique restait a zero et l'ecart n'etait jamais justifie.
 */
export function Cloture({
  session,
  surTermine,
  surAnnuler,
}: {
  session: { numero: string };
  surTermine: () => void;
  surAnnuler: () => void;
}) {
  const [nombres, setNombres] = useState<Record<number, number>>({});
  const [apercu, setApercu] = useState<{
    theoriqueEspecesCentimes: number;
    compteEspecesCentimes: number;
    ecartEspecesCentimes: number;
    justificationRequise: boolean;
    nombreTickets: number;
  } | null>(null);
  const [justification, setJustification] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const comptage = COUPURES.filter((c) => (nombres[c] ?? 0) > 0).map((c) => ({
    coupureCentimes: c,
    nombre: nombres[c],
  }));

  useEffect(() => {
    let vivant = true;
    void caisse()
      .previsualiserCloture(comptage)
      .then((a) => { if (vivant) setApercu(a); })
      .catch(() => undefined);
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(comptage)]);

  const cloturer = async () => {
    setErreur(null);
    setEnCours(true);
    try {
      await caisse().cloturer(comptage, justification);
      surTermine();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  };

  const ecart = apercu?.ecartEspecesCentimes ?? 0;

  return (
    <div className="plein-ecran">
      <div className="bandeau">
        <span className="titre">Cloture Z — {session.numero}</span>
        <span className="espace" />
        <button onClick={surAnnuler}>Retour a la vente</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'grid',
        gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div className="carte" style={{ width: '100%' }}>
          <h2 style={{ marginTop: 0 }}>Comptage des especes</h2>
          <p className="discret">Comptez le contenu du tiroir, coupure par coupure.</p>
          <table>
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
                  <td>{formater(coupure)} DA</td>
                  <td className="nombre" style={{ width: 130 }}>
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
        </div>

        <div className="carte" style={{ width: '100%' }}>
          <h2 style={{ marginTop: 0 }}>Resultat</h2>

          <div className="ligne-total">
            <span>Tickets de la session</span>
            <span>{apercu?.nombreTickets ?? 0}</span>
          </div>
          <div className="ligne-total">
            <span>Especes attendues</span>
            <span>{formater(apercu?.theoriqueEspecesCentimes ?? 0)} DA</span>
          </div>
          <div className="ligne-total">
            <span>Especes comptees</span>
            <span>{formater(apercu?.compteEspecesCentimes ?? 0)} DA</span>
          </div>
          <div
            className="ligne-total grand"
            style={{ color: ecart === 0 ? 'var(--vert)' : 'var(--orange)' }}
          >
            <span>Ecart</span>
            <span>{ecart > 0 ? '+' : ''}{formater(ecart)} DA</span>
          </div>

          {apercu?.justificationRequise && (
            <div className="champ" style={{ marginTop: 16 }}>
              <label htmlFor="justification">
                Justification de l&apos;ecart (obligatoire)
              </label>
              <input
                id="justification"
                value={justification}
                placeholder="Erreur de rendu, prelevement non saisi, ..."
                onChange={(e) => setJustification(e.target.value)}
              />
            </div>
          )}

          {erreur && <div className="message erreur">{erreur}</div>}

          <button
            className="valide"
            style={{ width: '100%', marginTop: 16, minHeight: 64, fontSize: 20 }}
            disabled={
              comptage.length === 0 ||
              enCours ||
              (apercu?.justificationRequise === true && justification.trim().length < 3)
            }
            onClick={() => void cloturer()}
          >
            {enCours ? 'Cloture en cours...' : 'Cloturer la caisse'}
          </button>

          <p className="discret" style={{ marginTop: 12 }}>
            La cloture est definitive. Elle sera remontee au serveur des le retour du reseau.
          </p>
        </div>
      </div>
    </div>
  );
}
