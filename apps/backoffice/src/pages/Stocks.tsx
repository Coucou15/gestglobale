import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterQuantite, formaterDate } from '../client';

interface Alerte {
  articleId: string; reference: string; designation: string; emplacement: string;
  quantiteMilli: number; seuilAlerteMilli: number;
  depuisDepotMilli: number; aCommanderMilli: number;
}

interface Negatif {
  reference: string; designation: string; unite: string;
  emplacement: { nom: string }; quantiteMilli: number; valeurManquanteCentimes: number;
}

interface Peremption {
  numero: string; datePeremption: string; quantiteMilli: number;
  article: { reference: string; designation: string; unite: string };
  emplacement: { nom: string };
}

export function Stocks() {
  const [onglet, setOnglet] = useState<'alertes' | 'negatifs' | 'peremptions'>('alertes');
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [negatifs, setNegatifs] = useState<Negatif[]>([]);
  const [peremptions, setPeremptions] = useState<Peremption[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const charger = async () => {
      setErreur(null);
      try {
        if (onglet === 'alertes') setAlertes(await appeler('/stocks/alertes'));
        if (onglet === 'negatifs') setNegatifs(await appeler('/stocks/negatifs'));
        if (onglet === 'peremptions') setPeremptions(await appeler('/stocks/peremptions?jours=10'));
      } catch (e) {
        setErreur(e instanceof Error ? e.message : String(e));
      }
    };
    void charger();
  }, [onglet]);

  return (
    <>
      <div className="entete-page">
        <h1>Stocks</h1>
      </div>

      <div className="barre-outils">
        <button className={onglet === 'alertes' ? 'principal' : ''} onClick={() => setOnglet('alertes')}>
          Reassort
        </button>
        <button className={onglet === 'negatifs' ? 'principal' : ''} onClick={() => setOnglet('negatifs')}>
          Stocks negatifs
        </button>
        <button className={onglet === 'peremptions' ? 'principal' : ''} onClick={() => setOnglet('peremptions')}>
          Peremptions
        </button>
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}

      {onglet === 'alertes' && (
        <>
          <p className="discret">
            Articles sous leur seuil. La colonne « depuis le depot » indique ce qui peut etre
            transfere avant de commander au fournisseur.
          </p>
          <div className="tableau">
            <table>
              <thead>
                <tr>
                  <th>Reference</th><th>Designation</th><th>Emplacement</th>
                  <th className="nombre">Stock</th><th className="nombre">Seuil</th>
                  <th className="nombre">Depuis le depot</th><th className="nombre">A commander</th>
                </tr>
              </thead>
              <tbody>
                {alertes.map((a) => (
                  <tr key={`${a.articleId}-${a.emplacement}`}>
                    <td>{a.reference}</td>
                    <td>{a.designation}</td>
                    <td>{a.emplacement}</td>
                    <td className="nombre">{formaterQuantite(a.quantiteMilli, 0)}</td>
                    <td className="nombre discret">{formaterQuantite(a.seuilAlerteMilli, 0)}</td>
                    <td className="nombre">{formaterQuantite(a.depuisDepotMilli, 0)}</td>
                    <td className="nombre">{formaterQuantite(a.aCommanderMilli, 0)}</td>
                  </tr>
                ))}
                {alertes.length === 0 && <tr><td colSpan={7} className="discret">Aucune alerte</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {onglet === 'negatifs' && (
        <>
          <p className="discret">
            Un stock negatif signale un ecart reel entre la base et le rayon : il se corrige par un
            inventaire, pas par une saisie directe.
          </p>
          <div className="tableau">
            <table>
              <thead>
                <tr>
                  <th>Reference</th><th>Designation</th><th>Emplacement</th>
                  <th className="nombre">Quantite</th><th className="nombre">Valeur manquante</th>
                </tr>
              </thead>
              <tbody>
                {negatifs.map((n, i) => (
                  <tr key={i}>
                    <td>{n.reference}</td>
                    <td>{n.designation}</td>
                    <td>{n.emplacement.nom}</td>
                    <td className="nombre" style={{ color: 'var(--rouge)' }}>
                      {formaterQuantite(n.quantiteMilli, 0)} {n.unite}
                    </td>
                    <td className="nombre">{formaterDA(n.valeurManquanteCentimes)}</td>
                  </tr>
                ))}
                {negatifs.length === 0 && (
                  <tr><td colSpan={5} className="discret">Aucun stock negatif</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {onglet === 'peremptions' && (
        <div className="tableau">
          <table>
            <thead>
              <tr>
                <th>Reference</th><th>Designation</th><th>Lot</th>
                <th>Peremption</th><th>Emplacement</th><th className="nombre">Quantite</th>
              </tr>
            </thead>
            <tbody>
              {peremptions.map((p, i) => (
                <tr key={i}>
                  <td>{p.article.reference}</td>
                  <td>{p.article.designation}</td>
                  <td>{p.numero}</td>
                  <td>{formaterDate(p.datePeremption)}</td>
                  <td>{p.emplacement.nom}</td>
                  <td className="nombre">{formaterQuantite(p.quantiteMilli, 0)} {p.article.unite}</td>
                </tr>
              ))}
              {peremptions.length === 0 && (
                <tr><td colSpan={6} className="discret">Aucun lot proche de la peremption</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
