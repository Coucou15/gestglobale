import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate } from '../client';
import type { Utilisateur } from '../Application';

interface VentesJour {
  nombreTickets: number;
  chiffreAffairesTtcCentimes: number;
  chiffreAffairesHtCentimes: number;
  margeCentimes: number;
  panierMoyenCentimes: number;
  parModePaiement: Array<{ mode: string; montantCentimes: number }>;
}

interface EtatCaisse {
  caisseId: string;
  numero: number;
  libelle: string;
  magasin: { code: string; nom: string };
  sessionOuverte: { numero: string; ouverteLe: string } | null;
  derniereRemonteeLe: string | null;
  jamaisSynchronisee: boolean;
  couleur: 'vert' | 'orange' | 'rouge';
}

/**
 * Ce que le gerant consulte depuis son smartphone, hors du magasin
 * (critere de recette du lot 1).
 */
export function TableauDeBord({ utilisateur }: { utilisateur: Utilisateur }) {
  const [ventes, setVentes] = useState<VentesJour | null>(null);
  const [caisses, setCaisses] = useState<EtatCaisse[]>([]);
  const [tresorerie, setTresorerie] = useState<{ totalCentimes: number } | null>(null);
  const [negatifs, setNegatifs] = useState<number | null>(null);
  const [alertes, setAlertes] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // Chaque role ne demande que ce qu'il a le droit de voir : un
  // magasinier n'a pas a declencher un appel aux ventes qui lui sera
  // refuse, ni a lire un message d'erreur en arrivant sur son ecran.
  const voitVentes =
    utilisateur.permissions.includes('rapport.son_magasin') ||
    utilisateur.permissions.includes('rapport.tous');
  const voitTresorerie = utilisateur.permissions.includes('tresorerie.voir');
  const voitStocks = utilisateur.permissions.includes('stock.voir');
  const voitMarge = utilisateur.permissions.includes('article.voir_prix_achat_et_marge');

  const charger = async () => {
    setErreur(null);
    try {
      if (voitVentes) {
        const [v, c] = await Promise.all([
          appeler<VentesJour>('/ventes/jour'),
          appeler<EtatCaisse[]>('/sync/etat'),
        ]);
        setVentes(v);
        setCaisses(c);
      }
      if (voitTresorerie) {
        setTresorerie(await appeler('/tresorerie/situation'));
      }
      if (voitStocks) {
        const [negatifsListe, alertesListe] = await Promise.all([
          appeler<unknown[]>('/stocks/negatifs'),
          appeler<unknown[]>('/stocks/alertes'),
        ]);
        setNegatifs(negatifsListe.length);
        setAlertes(alertesListe.length);
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void charger();
    const minuterie = setInterval(() => void charger(), 60000);
    return () => clearInterval(minuterie);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tauxMarge =
    ventes && ventes.chiffreAffairesHtCentimes > 0
      ? (ventes.margeCentimes / ventes.chiffreAffairesHtCentimes) * 100
      : 0;

  return (
    <>
      <div className="entete-page">
        <h1>Aujourd&apos;hui</h1>
        <span className="espace" />
        <button onClick={() => void charger()}>Actualiser</button>
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}

      <div className="cartes">
        {voitVentes && (
          <>
            <div className="carte">
              <div className="intitule">Chiffre d&apos;affaires TTC</div>
              <div className="valeur">{formaterDA(ventes?.chiffreAffairesTtcCentimes)}</div>
              <div className="detail">{ventes?.nombreTickets ?? 0} ticket(s)</div>
            </div>
            <div className="carte">
              <div className="intitule">Panier moyen</div>
              <div className="valeur">{formaterDA(ventes?.panierMoyenCentimes)}</div>
            </div>
          </>
        )}
        {voitVentes && voitMarge && (
          <div className="carte">
            <div className="intitule">Marge du jour</div>
            <div className="valeur">{formaterDA(ventes?.margeCentimes)}</div>
            <div className="detail">{tauxMarge.toFixed(1).replace('.', ',')} % du HT</div>
          </div>
        )}
        {alertes !== null && (
          <div className="carte">
            <div className="intitule">Articles a reassortir</div>
            <div className="valeur" style={{ color: alertes > 0 ? 'var(--orange)' : undefined }}>
              {alertes}
            </div>
            <div className="detail">sous leur seuil d&apos;alerte</div>
          </div>
        )}
        {tresorerie && (
          <div className="carte">
            <div className="intitule">Tresorerie consolidee</div>
            <div className="valeur">{formaterDA(tresorerie.totalCentimes)}</div>
          </div>
        )}
        {negatifs !== null && negatifs > 0 && (
          <div className="carte">
            <div className="intitule">Stocks negatifs</div>
            <div className="valeur" style={{ color: 'var(--orange)' }}>{negatifs}</div>
            <div className="detail">A corriger par inventaire</div>
          </div>
        )}
      </div>

      {!voitVentes && (
        <p className="discret">
          Votre role ne donne pas acces aux ventes. Les indicateurs ci-dessus concernent le
          stock dont vous avez la charge.
        </p>
      )}

      {voitVentes && (
      <>
      <h2 style={{ fontSize: 18, marginTop: 28 }}>Reglements du jour</h2>
      <div className="tableau">
        <table>
          <thead>
            <tr><th>Mode</th><th className="nombre">Montant</th></tr>
          </thead>
          <tbody>
            {(ventes?.parModePaiement ?? []).map((m) => (
              <tr key={m.mode}>
                <td>{m.mode.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="nombre">{formaterDA(m.montantCentimes)}</td>
              </tr>
            ))}
            {(ventes?.parModePaiement ?? []).length === 0 && (
              <tr><td colSpan={2} className="discret">Aucune vente aujourd&apos;hui</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>Caisses</h2>
      <div className="tableau">
        <table>
          <thead>
            <tr>
              <th>Caisse</th><th>Magasin</th><th>Session</th>
              <th>Derniere remontee</th><th>Etat</th>
            </tr>
          </thead>
          <tbody>
            {caisses.map((c) => (
              <tr key={c.caisseId}>
                <td>{c.libelle}</td>
                <td>{c.magasin.nom}</td>
                <td>{c.sessionOuverte ? c.sessionOuverte.numero : <span className="discret">fermee</span>}</td>
                <td>{formaterDate(c.derniereRemonteeLe)}</td>
                <td>
                  <span className={`etiquette ${c.jamaisSynchronisee ? 'neutre' : c.couleur}`}>
                    {c.jamaisSynchronisee ? 'Jamais synchronisee'
                      : c.couleur === 'vert' ? 'En ligne'
                      : c.couleur === 'orange' ? 'Hors ligne' : 'Plus de 24 h'}
                  </span>
                </td>
              </tr>
            ))}
            {caisses.length === 0 && (
              <tr><td colSpan={5} className="discret">Aucune caisse declaree</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </>
      )}
    </>
  );
}
