import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterQuantite } from '../client';
import type { Utilisateur } from '../Application';

interface Article {
  id: string;
  reference: string;
  designation: string;
  unite: string;
  decimales: number;
  tauxTva: number;
  archive: boolean;
  venteAutorisee: boolean;
  codesBarres: string[];
  prix: Record<string, number>;
  stockTotalMilli: number;
  cumpCentimes?: number;
  margePourcent?: number;
  venteAPerte?: boolean;
}

export function Articles({ utilisateur }: { utilisateur: Utilisateur }) {
  const [texte, setTexte] = useState('');
  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filtre, setFiltre] = useState<'actifs' | 'archives' | 'tous' | 'sans_code'>('actifs');
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);

  const voitMarge = utilisateur.permissions.includes('article.voir_prix_achat_et_marge');

  const charger = async () => {
    setChargement(true);
    setErreur(null);
    try {
      const parametres = new URLSearchParams({ page: String(page), taille: '50' });
      if (texte.trim()) parametres.set('texte', texte.trim());
      if (filtre === 'actifs') parametres.set('archive', 'false');
      if (filtre === 'archives') parametres.set('archive', 'true');
      if (filtre === 'sans_code') parametres.set('sansCodeBarre', 'true');

      const reponse = await appeler<{ total: number; articles: Article[] }>(
        `/articles?${parametres.toString()}`,
      );
      setArticles(reponse.articles);
      setTotal(reponse.total);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setChargement(false);
    }
  };

  // Recherche differee : on n'interroge pas le serveur a chaque frappe.
  useEffect(() => {
    const minuterie = setTimeout(() => void charger(), 300);
    return () => clearTimeout(minuterie);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texte, filtre, page]);

  return (
    <>
      <div className="entete-page">
        <h1>Articles</h1>
        <span className="espace" />
        <span className="discret">{total.toLocaleString('fr-FR')} article(s)</span>
      </div>

      <div className="barre-outils">
        <input
          placeholder="Reference, designation ou code-barres"
          value={texte}
          onChange={(e) => { setTexte(e.target.value); setPage(1); }}
        />
        <select
          value={filtre}
          onChange={(e) => { setFiltre(e.target.value as typeof filtre); setPage(1); }}
        >
          <option value="actifs">Articles actifs</option>
          <option value="archives">Articles archives</option>
          <option value="sans_code">Sans code-barres</option>
          <option value="tous">Tous</option>
        </select>
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}

      <div className="tableau">
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Designation</th>
              <th>Code-barres</th>
              <th className="nombre">Stock</th>
              <th className="nombre">Prix detail</th>
              {voitMarge && <th className="nombre">CUMP</th>}
              {voitMarge && <th className="nombre">Marge</th>}
            </tr>
          </thead>
          <tbody>
            {articles.map((a) => (
              <tr key={a.id}>
                <td>{a.reference}</td>
                <td>
                  {a.designation}
                  {a.archive && <> <span className="etiquette neutre">archive</span></>}
                  {!a.venteAutorisee && <> <span className="etiquette orange">hors vente</span></>}
                </td>
                <td className="discret">{a.codesBarres[0] ?? '—'}</td>
                <td className="nombre">{formaterQuantite(a.stockTotalMilli, a.decimales)} {a.unite}</td>
                <td className="nombre">{formaterDA(a.prix.DETAIL ?? a.prix.PACK)}</td>
                {voitMarge && <td className="nombre">{formaterDA(a.cumpCentimes)}</td>}
                {voitMarge && (
                  <td className="nombre">
                    {a.venteAPerte ? (
                      <span className="etiquette rouge">a perte</span>
                    ) : (
                      `${(a.margePourcent ?? 0).toFixed(1).replace('.', ',')} %`
                    )}
                  </td>
                )}
              </tr>
            ))}
            {articles.length === 0 && !chargement && (
              <tr>
                <td colSpan={voitMarge ? 7 : 5} className="discret">Aucun article</td>
              </tr>
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
    </>
  );
}
