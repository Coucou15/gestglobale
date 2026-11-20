import { useEffect, useRef, useState } from 'react';
import { appeler, formaterDA } from '../client';

export interface ArticleTrouve {
  id: string;
  reference: string;
  designation: string;
  unite: string;
  decimales: number;
  tauxTva: number;
  prix: Record<string, number>;
  cumpCentimes?: number;
  dernierPrixAchatCentimes?: number;
}

/**
 * Champ de recherche d'article, utilisable a la douchette comme au
 * clavier : un code-barres scanne se termine par une validation, ce qui
 * selectionne directement l'article s'il est unique.
 */
export function ChercheurArticle({
  surChoix,
  placeholder = 'Code-barres, reference ou designation',
}: {
  surChoix: (article: ArticleTrouve) => void;
  placeholder?: string;
}) {
  const [texte, setTexte] = useState('');
  const [resultats, setResultats] = useState<ArticleTrouve[]>([]);
  const [chargement, setChargement] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (texte.trim().length < 2) { setResultats([]); return; }
    let vivant = true;
    const minuterie = setTimeout(async () => {
      setChargement(true);
      try {
        const reponse = await appeler<{ articles: ArticleTrouve[] }>(
          `/articles?texte=${encodeURIComponent(texte.trim())}&archive=false&taille=12`,
        );
        if (vivant) setResultats(reponse.articles);
      } catch {
        if (vivant) setResultats([]);
      } finally {
        if (vivant) setChargement(false);
      }
    }, 250);
    return () => { vivant = false; clearTimeout(minuterie); };
  }, [texte]);

  const choisir = (article: ArticleTrouve) => {
    surChoix(article);
    setTexte('');
    setResultats([]);
    champ.current?.focus();
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={champ}
        value={texte}
        placeholder={placeholder}
        onChange={(e) => setTexte(e.target.value)}
        onKeyDown={(e) => {
          // Une douchette termine par Entree : si un seul article
          // correspond, il est pris sans que le magasinier clique.
          if (e.key === 'Enter' && resultats.length >= 1) choisir(resultats[0]);
          if (e.key === 'Escape') { setTexte(''); setResultats([]); }
        }}
      />
      {resultats.length > 0 && (
        <div
          className="tableau"
          style={{ position: 'absolute', zIndex: 20, width: '100%', marginTop: 4,
            maxHeight: 320, overflowY: 'auto' }}
        >
          <table>
            <tbody>
              {resultats.map((a) => (
                <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => choisir(a)}>
                  <td style={{ width: 110 }} className="discret">{a.reference}</td>
                  <td>{a.designation}</td>
                  <td className="nombre discret">
                    {a.dernierPrixAchatCentimes !== undefined
                      ? `achat ${formaterDA(a.dernierPrixAchatCentimes)}`
                      : formaterDA(a.prix.DETAIL)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {chargement && texte.length >= 2 && resultats.length === 0 && (
        <div className="discret" style={{ marginTop: 6 }}>Recherche...</div>
      )}
      {!chargement && texte.trim().length >= 2 && resultats.length === 0 && (
        <div className="discret" style={{ marginTop: 6 }}>Aucun article</div>
      )}
    </div>
  );
}
