import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate, ouvrirImpression, telecharger } from '../client';
import { ChercheurArticle, type ArticleTrouve } from '../composants/ChercheurArticle';
import { useReferentiel } from '../composants/referentiel';
import type { Utilisateur } from '../Application';
import { ChoixMagasin } from '../composants/ChoixMagasin';

interface Document {
  id: string; numero: string; type: string; statut: string; brouillon: boolean;
  dateVente: string; dateEcheance: string | null;
  totalTtcCentimes: number;
  client: { code: string; raisonSociale: string } | null;
  utilisateur: { code: string; nom: string };
  _count: { lignes: number };
}

interface ClientTrouve {
  id: string; code: string; raisonSociale: string; categoriePrix: string;
  remisePourcent: number; soldeCentimes: number; plafondCreditCentimes: number; bloque: boolean;
}

interface LigneSaisie { article: ArticleTrouve; quantite: string; remise: string }

const TYPES = [
  { valeur: 'FACTURE', libelle: 'Facture' },
  { valeur: 'BON_LIVRAISON', libelle: 'Bon de livraison' },
  { valeur: 'PROFORMA', libelle: 'Proforma' },
  { valeur: 'AVOIR', libelle: 'Avoir' },
];
const LIBELLE: Record<string, string> = Object.fromEntries(
  TYPES.map((t) => [t.valeur, t.libelle]),
);

const enMilli = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 1000) : 0;
};

/**
 * Documents de vente a valeur legale (M5).
 *
 * Un document naît en brouillon : rien ne bouge tant qu'il n'est pas
 * valide. A la validation il recoit son numero definitif, ses mentions
 * legales sont figees, et il ne se modifie plus — seul un avoir peut le
 * contredire.
 */
export function Documents({ utilisateur }: { utilisateur: Utilisateur }) {
  const voitTresorerie = utilisateur.permissions.includes('tresorerie.voir');
  const { magasins, comptes, pret } = useReferentiel({ avecComptes: voitTresorerie });
  const [documents, setDocuments] = useState<Document[]>([]);
  const [filtre, setFiltre] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const [saisie, setSaisie] = useState(false);
  const [type, setType] = useState('FACTURE');
  const [client, setClient] = useState<ClientTrouve | null>(null);
  const [rechercheClient, setRechercheClient] = useState('');
  const [clients, setClients] = useState<ClientTrouve[]>([]);
  const [lignes, setLignes] = useState<LigneSaisie[]>([]);
  const [echeance, setEcheance] = useState('');
  const [observation, setObservation] = useState('');

  const [aValider, setAValider] = useState<Document | null>(null);
  const [mode, setMode] = useState<'CREDIT' | 'ESPECES' | 'CARTE' | 'CHEQUE'>('CREDIT');
  const [compteId, setCompteId] = useState('');

  // Le magasin est choisi, jamais devine : voir ChoixMagasin.
  const [magasinId, setMagasinId] = useState('');
  const magasin = magasins.find((m) => m.id === magasinId) ?? magasins[0];

  useEffect(() => {
    if (!magasinId && magasins.length > 0) setMagasinId(magasins[0].id);
  }, [magasins, magasinId]);

  const charger = async () => {
    setErreur(null);
    try {
      const parametres = new URLSearchParams({});
      if (filtre) parametres.set('type', filtre);
      setDocuments(await appeler<Document[]>(`/ventes/documents?${parametres.toString()}`));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { void charger(); /* eslint-disable-next-line */ }, [filtre]);

  useEffect(() => {
    if (rechercheClient.trim().length < 2) { setClients([]); return; }
    let vivant = true;
    const minuterie = setTimeout(async () => {
      try {
        const r = await appeler<{ tiers: ClientTrouve[] }>(
          `/tiers?type=CLIENT&texte=${encodeURIComponent(rechercheClient.trim())}&taille=10`,
        );
        if (vivant) setClients(r.tiers);
      } catch { /* la recherche peut echouer sans consequence */ }
    }, 250);
    return () => { vivant = false; clearTimeout(minuterie); };
  }, [rechercheClient]);

  useEffect(() => {
    if (!compteId && comptes[0]) setCompteId(comptes[0].id);
  }, [comptes, compteId]);

  const creer = async () => {
    setErreur(null); setInfo(null); setOccupe(true);
    try {
      const cree = await appeler<{ id: string }>('/ventes/documents', {
        methode: 'POST',
        corps: {
          type,
          magasinId: magasin.id,
          clientId: client?.id,
          dateEcheance: echeance || undefined,
          observation: observation || undefined,
          lignes: lignes.map((l) => ({
            articleId: l.article.id,
            quantiteMilli: enMilli(l.quantite),
            remisePourcent: Math.round(Number(l.remise.replace(',', '.')) || 0),
          })),
        },
      });
      setSaisie(false); setLignes([]); setClient(null); setObservation(''); setEcheance('');
      await charger();
      const liste = await appeler<Document[]>('/ventes/documents?brouillon=true');
      setAValider(liste.find((d) => d.id === cree.id) ?? null);
      setInfo('Brouillon enregistre : verifiez-le, puis validez pour lui donner son numero.');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const valider = async () => {
    if (!aValider) return;
    setErreur(null); setOccupe(true);
    try {
      const valide = await appeler<{ numero: string }>(`/ventes/documents/${aValider.id}/valider`, {
        methode: 'POST',
        corps: { modePaiement: mode, ...(mode === 'CREDIT' ? {} : { compteId }) },
      });
      setInfo(`${LIBELLE[aValider.type] ?? aValider.type} ${valide.numero} validee.`);
      setAValider(null);
      await charger();
      await ouvrirImpression(`/ventes/documents/${valide.numero}/impression`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const transformer = async (document: Document, vers: string) => {
    setErreur(null); setInfo(null); setOccupe(true);
    try {
      await appeler(`/ventes/documents/${document.id}/transformer`, {
        methode: 'POST', corps: { vers },
      });
      await charger();
      setInfo(`Brouillon de ${LIBELLE[vers]} etabli d'apres ${document.numero}.`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const supprimer = async (document: Document) => {
    setErreur(null); setOccupe(true);
    try {
      await appeler(`/ventes/documents/${document.id}`, { methode: 'DELETE' });
      await charger();
      setInfo('Brouillon supprime.');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  if (!pret) return <div className="discret">Chargement du referentiel...</div>;
  if (!magasin) return <div className="message erreur">Aucun magasin accessible.</div>;

  const transformations: Record<string, Array<{ vers: string; libelle: string }>> = {
    PROFORMA: [
      { vers: 'FACTURE', libelle: 'En facture' },
      { vers: 'BON_LIVRAISON', libelle: 'En bon de livraison' },
    ],
    BON_LIVRAISON: [{ vers: 'FACTURE', libelle: 'En facture' }],
    FACTURE: [{ vers: 'AVOIR', libelle: 'Etablir un avoir' }],
  };

  return (
    <>
      <div className="entete-page">
        <h1>Documents de vente</h1>
        <span className="espace" />
        {!saisie && (
          <button className="principal" onClick={() => setSaisie(true)}>Nouveau document</button>
        )}
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}
      {info && <div className="message info">{info}</div>}

      {saisie && (
        <div className="carte" style={{ marginBottom: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Nouveau document</h2>

          <div className="barre-outils">
            <ChoixMagasin magasins={magasins} valeur={magasin?.id ?? ''}
              surChoix={setMagasinId} />
          </div>

          <div className="barre-outils">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t.valeur} value={t.valeur}>{t.libelle}</option>)}
            </select>
            <input
              placeholder="Client (nom, code)"
              value={client ? `${client.code} — ${client.raisonSociale}` : rechercheClient}
              onChange={(e) => { setClient(null); setRechercheClient(e.target.value); }}
            />
            <input type="date" value={echeance} onChange={(e) => setEcheance(e.target.value)} />
          </div>

          {clients.length > 0 && !client && (
            <div className="tableau" style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
              <table>
                <tbody>
                  {clients.map((cl) => (
                    <tr key={cl.id} style={{ cursor: 'pointer' }}
                      onClick={() => { setClient(cl); setClients([]); setRechercheClient(''); }}>
                      <td className="discret" style={{ width: 90 }}>{cl.code}</td>
                      <td>{cl.raisonSociale}{cl.bloque && <> <span className="etiquette rouge">bloque</span></>}</td>
                      <td className="nombre discret">solde {formaterDA(cl.soldeCentimes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {type === 'FACTURE' && !client && (
            <div className="message info">
              Une facture exige un client identifie : ses RC, NIF, NIS et article d&apos;imposition
              seront imprimes dessus.
            </div>
          )}

          <div style={{ margin: '12px 0' }}>
            <ChercheurArticle
              surChoix={(article) =>
                setLignes((l) =>
                  l.some((x) => x.article.id === article.id)
                    ? l
                    : [...l, { article, quantite: '1', remise: String(client?.remisePourcent ?? 0) }],
                )
              }
              placeholder="Scannez ou cherchez l'article a facturer"
            />
          </div>

          {lignes.length > 0 && (
            <div className="tableau">
              <table>
                <thead>
                  <tr>
                    <th>Article</th>
                    <th className="nombre" style={{ width: 110 }}>Quantite</th>
                    <th className="nombre" style={{ width: 100 }}>Remise %</th>
                    <th className="nombre">Prix unitaire</th>
                    <th style={{ width: 50 }} />
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l, i) => (
                    <tr key={l.article.id}>
                      <td>
                        {l.article.designation}
                        <br /><span className="discret">{l.article.reference}</span>
                      </td>
                      <td>
                        <input value={l.quantite} inputMode="decimal"
                          style={{ textAlign: 'right', minHeight: 38, padding: 8 }}
                          onChange={(e) => setLignes((liste) =>
                            liste.map((x, j) => (j === i ? { ...x, quantite: e.target.value } : x)))} />
                      </td>
                      <td>
                        <input value={l.remise} inputMode="decimal"
                          style={{ textAlign: 'right', minHeight: 38, padding: 8 }}
                          onChange={(e) => setLignes((liste) =>
                            liste.map((x, j) => (j === i ? { ...x, remise: e.target.value } : x)))} />
                      </td>
                      <td className="nombre discret">{formaterDA(l.article.prix.DETAIL)}</td>
                      <td>
                        <button onClick={() => setLignes((liste) => liste.filter((_, j) => j !== i))}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <input style={{ marginTop: 12 }} placeholder="Observation (facultatif)"
            value={observation} onChange={(e) => setObservation(e.target.value)} />

          <div className="barre-outils" style={{ marginTop: 16 }}>
            <button onClick={() => { setSaisie(false); setLignes([]); }}>Annuler</button>
            <button
              className="principal"
              disabled={occupe || lignes.length === 0 || (type === 'FACTURE' && !client)}
              onClick={() => void creer()}
            >
              {occupe ? 'Enregistrement...' : 'Enregistrer le brouillon'}
            </button>
          </div>
        </div>
      )}

      {aValider && (
        <div className="voile" onClick={(e) => e.target === e.currentTarget && setAValider(null)}>
          <div className="modale">
            <h2>Valider ce {LIBELLE[aValider.type]?.toLowerCase() ?? 'document'}</h2>
            <p className="discret">
              {aValider.client?.raisonSociale ?? 'Client de passage'} —{' '}
              {formaterDA(aValider.totalTtcCentimes)}
            </p>

            {aValider.type !== 'PROFORMA' && (
              <div className="champ">
                <label>Reglement</label>
                <div className="barre-outils">
                  {(['CREDIT', 'ESPECES', 'CARTE', 'CHEQUE'] as const).map((m) => (
                    <button key={m} className={mode === m ? 'principal' : ''}
                      onClick={() => setMode(m)}>
                      {m === 'CREDIT' ? 'A credit' : m.toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {aValider.type !== 'PROFORMA' && mode !== 'CREDIT' && (
              <div className="champ">
                <label htmlFor="compte">Compte credite</label>
                <select id="compte" value={compteId} onChange={(e) => setCompteId(e.target.value)}>
                  {comptes.map((c) => (
                    <option key={c.id} value={c.id}>{c.libelle} — {formaterDA(c.soldeCentimes)}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="message info">
              {aValider.type === 'PROFORMA'
                ? 'Une proforma n’engage rien : ni stock, ni comptabilite. Elle recoit seulement son numero.'
                : 'La validation est definitive : numero attribue sans trou, mentions legales figees, stock sorti. Seul un avoir pourra la contredire.'}
            </div>

            <div className="barre-outils">
              <button style={{ flex: 1 }} onClick={() => setAValider(null)}>Plus tard</button>
              <button className="principal" style={{ flex: 2 }} disabled={occupe}
                onClick={() => void valider()}>
                {occupe ? 'Validation...' : 'Valider et imprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="barre-outils">
        <select value={filtre} onChange={(e) => setFiltre(e.target.value)}>
          <option value="">Tous les documents</option>
          {TYPES.map((t) => <option key={t.valeur} value={t.valeur}>{t.libelle}</option>)}
        </select>
      </div>

      <div className="tableau">
        <table>
          <thead>
            <tr>
              <th>Numero</th><th>Type</th><th>Date</th><th>Client</th>
              <th className="nombre">Lignes</th><th className="nombre">Total</th>
              <th>Etat</th><th />
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id}>
                <td>{d.brouillon ? <span className="discret">brouillon</span> : d.numero}</td>
                <td>{LIBELLE[d.type] ?? d.type}</td>
                <td>{formaterDate(d.dateVente).slice(0, 10)}</td>
                <td>{d.client?.raisonSociale ?? <span className="discret">passage</span>}</td>
                <td className="nombre">{d._count.lignes}</td>
                <td className="nombre">{formaterDA(d.totalTtcCentimes)}</td>
                <td>
                  <span className={`etiquette ${d.statut === 'ANNULE' ? 'rouge'
                    : d.brouillon ? 'orange' : 'vert'}`}>
                    {d.statut === 'ANNULE' ? 'annule' : d.brouillon ? 'brouillon' : 'valide'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {d.brouillon ? (
                    <>
                      <button onClick={() => setAValider(d)}>Valider</button>{' '}
                      <button disabled={occupe} onClick={() => void supprimer(d)}>×</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => {
                        void ouvrirImpression(`/ventes/documents/${d.numero}/impression`)
                          .catch((e) => setErreur(e instanceof Error ? e.message : String(e)));
                      }}>
                        Imprimer
                      </button>{' '}
                      {/*
                        Le PDF est fabrique par le serveur : c'est celui
                        qu'on joint a un courriel, la ou l'impression du
                        navigateur demande toujours un geste humain.
                      */}
                      <button disabled={occupe} onClick={() => {
                        setErreur(null);
                        void telecharger(`/ventes/documents/${d.numero}/document.pdf`)
                          .then((nom) => setInfo(`${nom} telecharge.`))
                          .catch((e) => setErreur(e instanceof Error ? e.message : String(e)));
                      }}>
                        PDF
                      </button>{' '}
                      {(transformations[d.type] ?? []).map((t) => (
                        <button key={t.vers} disabled={occupe}
                          onClick={() => void transformer(d, t.vers)}>
                          {t.libelle}
                        </button>
                      ))}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {documents.length === 0 && (
              <tr><td colSpan={8} className="discret">Aucun document</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
