import { useEffect, useRef, useState } from 'react';
import {
  caisse, type ArticleCaisse, type ClientCaisse, type EtatSync, type UtilisateurCaisse,
} from './api';
import { Voyant } from './Application';
import { Paiement } from './Paiement';

interface LigneAffichee {
  numeroLigne: number;
  article: ArticleCaisse;
  codeScanne: string | null;
  quantiteMilli: number;
  prixUnitaireCentimes: number;
  remisePourcent: number;
  remiseCentimes: number;
  annulee: boolean;
  autoriseeParId: string | null;
  promotionId: string | null;
}

function formater(centimes: number): string {
  return (centimes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 });
}

function formaterQte(milli: number, decimales: number): string {
  return (milli / 1000).toFixed(decimales).replace('.', ',');
}

function totalLigne(l: LigneAffichee): number {
  const brut = Math.round((l.quantiteMilli * l.prixUnitaireCentimes) / 1000);
  const remise = Math.min(brut, Math.round((brut * l.remisePourcent) / 100) + l.remiseCentimes);
  const ht = brut - remise;
  return ht + Math.round((ht * l.article.tauxTva) / 100);
}

export function EcranVente({
  utilisateur,
  plafondRemise,
  session,
  etatSync,
  surCloture,
  surDeconnexion,
}: {
  utilisateur: UtilisateurCaisse;
  plafondRemise: number;
  session: { numero: string };
  etatSync: EtatSync | null;
  surCloture: () => void;
  surDeconnexion: () => void;
}) {
  const [lignes, setLignes] = useState<LigneAffichee[]>([]);
  const [saisie, setSaisie] = useState('');
  const [selection, setSelection] = useState<number | null>(null);
  const [client, setClient] = useState<ClientCaisse | null>(null);
  const [message, setMessage] = useState<{ texte: string; ton: string } | null>(null);
  const [resultats, setResultats] = useState<ArticleCaisse[]>([]);
  const [paiementOuvert, setPaiementOuvert] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  // Le champ de saisie reprend toujours le focus : la douchette tape
  // dedans comme un clavier, sans que le caissier ait a cliquer.
  useEffect(() => {
    const remettre = () => champ.current?.focus();
    remettre();
    const minuterie = setInterval(remettre, 1500);
    return () => clearInterval(minuterie);
  }, [paiementOuvert]);

  const actives = lignes.filter((l) => !l.annulee);
  const total = actives.reduce((t, l) => t + totalLigne(l), 0);
  const nombreArticles = actives.reduce((t, l) => t + l.quantiteMilli / 1000, 0);

  const peut = (droit: string) => utilisateur.permissions.includes(droit);

  const ajouter = (article: ArticleCaisse, quantiteMilli: number, prix: number, code: string | null) => {
    setLignes((precedentes) => {
      const cumulable = precedentes.find(
        (l) => !l.annulee && l.article.id === article.id && l.prixUnitaireCentimes === prix
          && !l.article.estVrac && l.remisePourcent === 0 && l.remiseCentimes === 0,
      );
      if (cumulable) {
        return precedentes.map((l) =>
          l === cumulable ? { ...l, quantiteMilli: l.quantiteMilli + quantiteMilli } : l,
        );
      }
      return [
        ...precedentes,
        {
          numeroLigne: precedentes.length + 1,
          article, codeScanne: code, quantiteMilli,
          prixUnitaireCentimes: prix, remisePourcent: 0, remiseCentimes: 0,
          annulee: false, autoriseeParId: null, promotionId: null,
        },
      ];
    });
  };

  const scanner = async (code: string) => {
    setMessage(null);
    setResultats([]);
    const propre = code.trim();
    if (!propre) return;

    // Prefixe quantite : "3*" ou "2,5x" avant le code.
    const avecQuantite = /^(\d+(?:[.,]\d+)?)\s*[*x]\s*(.+)$/i.exec(propre);
    const multiplicateur = avecQuantite ? Number(avecQuantite[1].replace(',', '.')) : 1;
    const codeUtile = avecQuantite ? avecQuantite[2] : propre;

    const trouve = await caisse().chercherCode(codeUtile);
    if (trouve) {
      if (!trouve.article.venteAutorisee) {
        setMessage({ texte: `${trouve.article.designation} n'est plus en vente`, ton: 'erreur' });
        return;
      }
      if (trouve.prixUnitaireCentimes <= 0) {
        setMessage({
          texte: `${trouve.article.designation} n'a pas de prix : prevenez le gerant`,
          ton: 'erreur',
        });
        return;
      }
      ajouter(
        trouve.article,
        Math.round(trouve.quantiteMilli * multiplicateur),
        trouve.prixUnitaireCentimes,
        trouve.codeScanne,
      );
      setSaisie('');
      return;
    }

    const parNom = await caisse().chercherTexte(codeUtile);
    if (parNom.length === 0) {
      setMessage({ texte: `Aucun article pour « ${codeUtile} »`, ton: 'erreur' });
    } else if (parNom.length === 1) {
      ajouter(parNom[0], Math.round(1000 * multiplicateur), parNom[0].prixDetailCentimes, null);
      setSaisie('');
    } else {
      setResultats(parNom);
    }
  };

  const annulerLigne = (numero: number) => {
    if (!peut('vente.annuler_ligne')) {
      setMessage({
        texte: 'Annulation de ligne : code superviseur requis',
        ton: 'attention',
      });
      return;
    }
    setLignes((l) => l.map((x) => (x.numeroLigne === numero ? { ...x, annulee: true } : x)));
  };

  const changerQuantite = (numero: number, delta: number) => {
    setLignes((l) =>
      l.map((x) =>
        x.numeroLigne === numero
          ? { ...x, quantiteMilli: Math.max(1, x.quantiteMilli + delta) }
          : x,
      ),
    );
  };

  const viderTicket = () => {
    if (!peut('vente.annuler_ticket')) {
      setMessage({ texte: 'Annulation du ticket : code superviseur requis', ton: 'attention' });
      return;
    }
    setLignes([]);
    setClient(null);
  };

  return (
    <div className="plein-ecran">
      <div className="bandeau">
        <span className="titre">Caisse — {session.numero}</span>
        <span className="discret">{utilisateur.nom}</span>
        <span className="espace" />
        <Voyant etat={etatSync} />
        <button onClick={surCloture}>Cloture Z</button>
        <button onClick={surDeconnexion}>Changer de caissier</button>
      </div>

      <div className="vente">
        <div className="panneau-gauche">
          <input
            ref={champ}
            value={saisie}
            placeholder="Scannez un article, ou tapez un nom / une reference"
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void scanner(saisie);
              if (e.key === 'Escape') { setSaisie(''); setResultats([]); }
            }}
          />

          {message && <div className={`message ${message.ton}`}>{message.texte}</div>}

          {resultats.length > 0 && (
            <div className="lignes" style={{ maxHeight: 220 }}>
              <table>
                <tbody>
                  {resultats.map((a) => (
                    <tr key={a.id} onClick={() => { ajouter(a, 1000, a.prixDetailCentimes, null); setResultats([]); setSaisie(''); }}>
                      <td>{a.designation}</td>
                      <td className="nombre">{formater(a.prixDetailCentimes)} DA</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="lignes">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Article</th>
                  <th className="nombre">Qte</th>
                  <th className="nombre">P.U.</th>
                  <th className="nombre">Total</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr
                    key={l.numeroLigne}
                    className={l.annulee ? 'annulee' : ''}
                    onClick={() => setSelection(l.numeroLigne)}
                    style={{
                      background: selection === l.numeroLigne ? 'var(--surface-haute)' : undefined,
                    }}
                  >
                    <td className="discret">{l.numeroLigne}</td>
                    <td>{l.article.designation}</td>
                    <td className="nombre">{formaterQte(l.quantiteMilli, l.article.decimales)}</td>
                    <td className="nombre">{formater(l.prixUnitaireCentimes)}</td>
                    <td className="nombre">{l.annulee ? '—' : formater(totalLigne(l))}</td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="discret" style={{ textAlign: 'center', padding: 40 }}>
                      Scannez le premier article
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panneau-droit">
          <div className="totaux">
            <div className="ligne-total">
              <span>{actives.length} ligne(s) — {nombreArticles.toFixed(2).replace('.', ',')} article(s)</span>
            </div>
            {client && (
              <div className="ligne-total">
                <span>Client</span>
                <span>{client.nom}</span>
              </div>
            )}
            <div className="ligne-total grand">
              <span>A payer</span>
              <span>{formater(total)} DA</span>
            </div>
          </div>

          <div className="grille-touches">
            <button disabled={selection === null} onClick={() => selection && changerQuantite(selection, 1000)}>
              + 1
            </button>
            <button disabled={selection === null} onClick={() => selection && changerQuantite(selection, -1000)}>
              − 1
            </button>
            <button
              className="danger"
              disabled={selection === null}
              onClick={() => selection && annulerLigne(selection)}
            >
              Annuler ligne
            </button>

            <button onClick={() => void caisse().ouvrirTiroir()}>Tiroir</button>
            <button onClick={viderTicket}>Annuler ticket</button>
            <button onClick={() => void caisse().synchroniser()}>Synchroniser</button>
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ padding: 16 }}>
            <button
              className="valide"
              style={{ width: '100%', fontSize: 24, minHeight: 80 }}
              disabled={actives.length === 0}
              onClick={() => setPaiementOuvert(true)}
            >
              Encaisser — {formater(total)} DA
            </button>
          </div>
        </div>
      </div>

      {paiementOuvert && (
        <Paiement
          lignes={lignes}
          totalCentimes={total}
          client={client}
          plafondRemise={plafondRemise}
          permissions={utilisateur.permissions}
          surClient={setClient}
          surAnnuler={() => setPaiementOuvert(false)}
          surEncaisse={(numero) => {
            setPaiementOuvert(false);
            setLignes([]);
            setClient(null);
            setSelection(null);
            setMessage({ texte: `Ticket ${numero} encaisse`, ton: 'info' });
          }}
        />
      )}
    </div>
  );
}
