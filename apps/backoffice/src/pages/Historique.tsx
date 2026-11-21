import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate, formaterQuantite } from '../client';

interface Ligne {
  id: string;
  origine: string;
  ongletSource: string;
  ligneSource: number | null;
  date: string | null;
  heure: string | null;
  type: string | null;
  numeroDocument: string | null;
  reference: string | null;
  libelle: string | null;
  tiersCode: string | null;
  tiersNom: string | null;
  utilisateur: string | null;
  caisse: string | null;
  quantiteMilli: number | null;
  montantHtCentimes: number | null;
  montantTtcCentimes: number | null;
  margeCentimes: number | null;
  donnees: Record<string, string>;
}

const ORIGINES: Array<{ valeur: string; libelle: string }> = [
  { valeur: '', libelle: 'Toutes les origines' },
  { valeur: 'VENTE', libelle: 'Ventes et retours' },
  { valeur: 'MOUVEMENT_STOCK', libelle: 'Mouvements de stock' },
  { valeur: 'TRESORERIE', libelle: 'Tresorerie' },
  { valeur: 'RECEPTION', libelle: 'Receptions' },
  { valeur: 'CLOTURE_CAISSE', libelle: 'Clotures de caisse' },
];

const LIBELLE_ORIGINE: Record<string, string> = {
  VENTE: 'Vente', MOUVEMENT_STOCK: 'Stock', TRESORERIE: 'Tresorerie',
  RECEPTION: 'Reception', CLOTURE_CAISSE: 'Cloture',
};

/**
 * Historique repris de l'ancien logiciel, en lecture seule (section 7).
 *
 * Ces lignes ne sont pas rejouees dans les journaux vivants : le stock
 * repris est celui de la fin de la journee exportee, et rejouer les
 * mouvements de cette meme journee compterait deux fois la marchandise.
 * Elles servent a retrouver un document, pas a recalculer un solde.
 */
/**
 * Montant a montrer selon l'origine.
 *
 * Pour une cloture, la colonne utile est l'ecart, pas la recette
 * physique : afficher « 0,00 DA » a cote d'une cloture dont la caisse
 * manquait de 72 170 DA serait exact mais trompeur.
 */
function montantAffiche(l: Ligne) {
  if (l.origine === 'CLOTURE_CAISSE') {
    const ecart = l.margeCentimes ?? 0;
    return (
      <span
        className={`etiquette ${ecart === 0 ? 'vert' : 'rouge'}`}
        title={`Recette comptable ${formaterDA(l.montantHtCentimes ?? 0)}, ` +
          `recette physique ${formaterDA(l.montantTtcCentimes ?? 0)}`}
      >
        ecart {formaterDA(ecart)}
      </span>
    );
  }
  if (l.montantTtcCentimes !== null && l.montantTtcCentimes !== 0) {
    return formaterDA(l.montantTtcCentimes);
  }
  if (l.montantHtCentimes !== null && l.montantHtCentimes !== 0) {
    return formaterDA(l.montantHtCentimes);
  }
  return <span className="discret">—</span>;
}

export function Historique() {
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [total, setTotal] = useState(0);
  const [parOrigine, setParOrigine] = useState<Array<{ origine: string; nombre: number }>>([]);
  const [origine, setOrigine] = useState('');
  const [texte, setTexte] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Ligne | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const charger = async () => {
      setErreur(null);
      try {
        const parametres = new URLSearchParams({ page: String(page), taille: '50' });
        if (origine) parametres.set('origine', origine);
        if (texte.trim()) parametres.set('texte', texte.trim());
        const reponse = await appeler<{
          total: number; lignes: Ligne[];
          parOrigine: Array<{ origine: string; nombre: number }>;
        }>(`/import/historique?${parametres.toString()}`);
        setLignes(reponse.lignes);
        setTotal(reponse.total);
        setParOrigine(reponse.parOrigine);
      } catch (e) {
        setErreur(e instanceof Error ? e.message : String(e));
      }
    };
    const minuterie = setTimeout(() => void charger(), 250);
    return () => clearTimeout(minuterie);
  }, [origine, texte, page]);

  return (
    <>
      <div className="entete-page">
        <h1>Historique de l&apos;ancien logiciel</h1>
        <span className="espace" />
        <span className="discret">{total.toLocaleString('fr-FR')} ligne(s)</span>
      </div>

      <p className="discret">
        Repris en lecture seule a la bascule. Ces lignes servent a retrouver un document ancien ;
        elles n&apos;entrent ni dans les stocks ni dans la tresorerie d&apos;aujourd&apos;hui.
      </p>

      {parOrigine.length > 0 && (
        <div className="cartes" style={{ marginBottom: 20 }}>
          {parOrigine.map((o) => (
            <div className="carte" key={o.origine}>
              <div className="intitule">{LIBELLE_ORIGINE[o.origine] ?? o.origine}</div>
              <div className="valeur">{o.nombre.toLocaleString('fr-FR')}</div>
            </div>
          ))}
        </div>
      )}

      <div className="barre-outils">
        <select value={origine} onChange={(e) => { setOrigine(e.target.value); setPage(1); }}>
          {ORIGINES.map((o) => (
            <option key={o.valeur} value={o.valeur}>{o.libelle}</option>
          ))}
        </select>
        <input
          placeholder="Numero de document, produit, client..."
          value={texte}
          onChange={(e) => { setTexte(e.target.value); setPage(1); }}
        />
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}

      <div className="tableau">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Origine</th><th>Type</th><th>Document</th>
              <th>Libelle</th><th>Tiers</th>
              <th className="nombre">Quantite</th><th className="nombre">Montant</th><th />
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.date ? formaterDate(l.date).slice(0, 10) : '—'}
                  {l.heure && <> <span className="discret">{l.heure}</span></>}
                </td>
                <td><span className="etiquette neutre">{LIBELLE_ORIGINE[l.origine] ?? l.origine}</span></td>
                <td className="discret">{l.type ?? '—'}</td>
                <td>{l.numeroDocument ?? '—'}</td>
                <td>{l.libelle ?? l.reference ?? '—'}</td>
                <td className="discret">{l.tiersNom ?? l.tiersCode ?? '—'}</td>
                <td className="nombre">
                  {l.quantiteMilli === null ? '—' : formaterQuantite(l.quantiteMilli, 3)}
                </td>
                <td className="nombre">{montantAffiche(l)}</td>
                <td>
                  <button onClick={() => setDetail(l)}>Voir</button>
                </td>
              </tr>
            ))}
            {lignes.length === 0 && (
              <tr><td colSpan={9} className="discret">Aucune ligne d&apos;historique</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="barre-outils" style={{ marginTop: 16 }}>
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Precedent</button>
        <span className="discret" style={{ alignSelf: 'center' }}>
          Page {page} sur {Math.max(1, Math.ceil(total / 50))}
        </span>
        <button disabled={page * 50 >= total} onClick={() => setPage((p) => p + 1)}>Suivant</button>
      </div>

      {detail && (
        <div className="voile" onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modale">
            <h2>
              {LIBELLE_ORIGINE[detail.origine] ?? detail.origine}
              {detail.numeroDocument ? ` ${detail.numeroDocument}` : ''}
            </h2>
            <p className="discret">
              Onglet {detail.ongletSource}, ligne {detail.ligneSource} du fichier d&apos;origine.
              Toutes les colonnes sont conservees telles quelles.
            </p>
            <div className="tableau">
              <table>
                <tbody>
                  {Object.entries(detail.donnees).map(([cle, valeur]) => (
                    <tr key={cle}>
                      <td className="discret" style={{ width: 240 }}>
                        {cle.replace(/_/g, ' ')}
                      </td>
                      <td>{valeur}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button style={{ marginTop: 16, width: '100%' }} onClick={() => setDetail(null)}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </>
  );
}
