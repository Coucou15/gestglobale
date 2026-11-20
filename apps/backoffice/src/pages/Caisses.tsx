import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate } from '../client';

interface Cloture {
  numero: string; date: string;
  caisse: { numero: number; libelle: string };
  caissier: { code: string; nom: string } | null;
  theoriqueCentimes: number; compteCentimes: number; ecartCentimes: number;
  justification: string | null; horsLigne: boolean;
}

interface ParCaissier {
  utilisateurId: string; nom: string; code: string;
  nombre: number; totalEcart: number; pireEcart: number; ecartMoyenCentimes: number;
}

/**
 * Ecarts de caisse par caissier sur 30 jours (M9).
 * C'est le rapport que le gerant consultait en vain dans l'ancien
 * logiciel, ou la recette physique restait a zero.
 */
export function Caisses() {
  const [jours, setJours] = useState(30);
  const [clotures, setClotures] = useState<Cloture[]>([]);
  const [parCaissier, setParCaissier] = useState<ParCaissier[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const charger = async () => {
      setErreur(null);
      try {
        const reponse = await appeler<{ clotures: Cloture[]; parCaissier: ParCaissier[] }>(
          `/caisse/ecarts?jours=${jours}`,
        );
        setClotures(reponse.clotures);
        setParCaissier(reponse.parCaissier);
      } catch (e) {
        setErreur(e instanceof Error ? e.message : String(e));
      }
    };
    void charger();
  }, [jours]);

  const couleurEcart = (centimes: number) =>
    centimes === 0 ? 'vert' : Math.abs(centimes) > 100000 ? 'rouge' : 'orange';

  return (
    <>
      <div className="entete-page">
        <h1>Caisses et clotures Z</h1>
        <span className="espace" />
        <select
          style={{ width: 'auto' }}
          value={jours}
          onChange={(e) => setJours(Number(e.target.value))}
        >
          <option value={7}>7 jours</option>
          <option value={30}>30 jours</option>
          <option value={90}>90 jours</option>
        </select>
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}

      <h2 style={{ fontSize: 18 }}>Par caissier</h2>
      <div className="tableau">
        <table>
          <thead>
            <tr>
              <th>Caissier</th><th className="nombre">Clotures</th>
              <th className="nombre">Ecart cumule</th><th className="nombre">Ecart moyen</th>
              <th className="nombre">Pire ecart</th>
            </tr>
          </thead>
          <tbody>
            {parCaissier.map((c) => (
              <tr key={c.utilisateurId}>
                <td>{c.nom} <span className="discret">({c.code})</span></td>
                <td className="nombre">{c.nombre}</td>
                <td className="nombre">
                  <span className={`etiquette ${couleurEcart(c.totalEcart)}`}>
                    {formaterDA(c.totalEcart)}
                  </span>
                </td>
                <td className="nombre">{formaterDA(c.ecartMoyenCentimes)}</td>
                <td className="nombre">{formaterDA(c.pireEcart)}</td>
              </tr>
            ))}
            {parCaissier.length === 0 && (
              <tr><td colSpan={5} className="discret">Aucune cloture sur la periode</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>Clotures</h2>
      <div className="tableau">
        <table>
          <thead>
            <tr>
              <th>Numero</th><th>Date</th><th>Caisse</th><th>Caissier</th>
              <th className="nombre">Attendu</th><th className="nombre">Compte</th>
              <th className="nombre">Ecart</th><th>Justification</th>
            </tr>
          </thead>
          <tbody>
            {clotures.map((c) => (
              <tr key={c.numero}>
                <td>
                  {c.numero}
                  {c.horsLigne && <> <span className="etiquette neutre">hors ligne</span></>}
                </td>
                <td>{formaterDate(c.date)}</td>
                <td>{c.caisse.libelle}</td>
                <td>{c.caissier?.nom ?? '—'}</td>
                <td className="nombre">{formaterDA(c.theoriqueCentimes)}</td>
                <td className="nombre">{formaterDA(c.compteCentimes)}</td>
                <td className="nombre">
                  <span className={`etiquette ${couleurEcart(c.ecartCentimes)}`}>
                    {formaterDA(c.ecartCentimes)}
                  </span>
                </td>
                <td className="discret">{c.justification ?? '—'}</td>
              </tr>
            ))}
            {clotures.length === 0 && (
              <tr><td colSpan={8} className="discret">Aucune cloture sur la periode</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
