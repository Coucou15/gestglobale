import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate, formaterQuantite } from '../client';
import { ChercheurArticle, type ArticleTrouve } from '../composants/ChercheurArticle';
import type { Utilisateur } from '../Application';

/**
 * Transferts inter-magasins (M11).
 *
 * En deux temps : un bon d'expedition au depart, un bon de reception a
 * l'arrivee. Entre les deux, la marchandise est en transit — dans aucun
 * rayon, mais toujours dans les comptes du magasin expediteur.
 *
 * Ce qui arrive peut differer de ce qui est parti. L'ecran demande donc
 * un comptage a la reception, jamais une simple validation.
 */

interface Emplacement { id: string; code: string; nom: string; type: string }
interface Magasin { id: string; code: string; nom: string; emplacements: Emplacement[] }

interface Ligne {
  id: string;
  articleId: string;
  quantiteMilli: number;
  quantiteRecueMilli: number | null;
  ecartMilli: number | null;
  cumpCentimes: number;
  motifEcart: string | null;
  valeurExpedieeCentimes: number;
  valeurEcartCentimes: number | null;
  article: { reference: string; designation: string; unite: string };
}

interface Transfert {
  id: string;
  numero: string;
  numeroReception: string | null;
  statut: 'PREPARE' | 'EXPEDIE' | 'RECU' | 'ANNULE';
  motif: string | null;
  avecEcart: boolean;
  creeLe: string;
  expedieLe: string | null;
  recuLe: string | null;
  commentaireReception: string | null;
  joursEnTransit?: number;
  valeurExpedieeCentimes: number;
  valeurEcartCentimes: number;
  magasinSource: { code: string; nom: string };
  magasinDestination: { code: string; nom: string };
  emplacementSource: { code: string; nom: string };
  emplacementDestination: { code: string; nom: string };
  creePar: { nom: string } | null;
  expediePar: { nom: string } | null;
  recuPar: { nom: string } | null;
  lignes: Ligne[];
}

const ETATS: Record<string, { texte: string; couleur: string }> = {
  PREPARE: { texte: 'a expedier', couleur: 'neutre' },
  EXPEDIE: { texte: 'en transit', couleur: 'orange' },
  RECU: { texte: 'receptionne', couleur: 'vert' },
  ANNULE: { texte: 'annule', couleur: 'rouge' },
};

const QTE = (milli: number, unite = 'UN') =>
  formaterQuantite(milli, unite === 'KG' || unite === 'L' ? 3 : 0);

export function Transferts({ utilisateur }: { utilisateur: Utilisateur }) {
  const peutGerer = utilisateur.permissions.includes('stock.transfert');

  const [transferts, setTransferts] = useState<Transfert[]>([]);
  const [magasins, setMagasins] = useState<Magasin[]>([]);
  const [filtre, setFiltre] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [saisie, setSaisie] = useState(false);
  const [ouvert, setOuvert] = useState<string | null>(null);

  // Saisie d'un nouveau bon.
  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [emplSourceId, setEmplSourceId] = useState('');
  const [emplDestId, setEmplDestId] = useState('');
  const [motif, setMotif] = useState('');
  const [lignes, setLignes] = useState<Array<{ article: ArticleTrouve; quantite: string }>>([]);

  // Comptage a la reception : quantite saisie par article.
  const [comptage, setComptage] = useState<Record<string, string>>({});
  const [motifsEcart, setMotifsEcart] = useState<Record<string, string>>({});
  const [commentaire, setCommentaire] = useState('');

  const charger = async () => {
    setErreur(null);
    try {
      const p = new URLSearchParams();
      if (filtre) p.set('statut', filtre);
      setTransferts(await appeler<Transfert[]>(`/transferts?${p.toString()}`));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtre]);

  useEffect(() => {
    void appeler<Magasin[]>('/referentiel/magasins')
      .then((m) => {
        setMagasins(m);
        if (m.length > 0 && !sourceId) {
          setSourceId(m[0].id);
          const autre = m.find((x) => x.id !== m[0].id);
          if (autre) setDestinationId(autre.id);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emplacementsDe = (magasinId: string) =>
    (magasins.find((m) => m.id === magasinId)?.emplacements ?? [])
      .filter((e) => e.type !== 'TRANSIT');

  useEffect(() => {
    const liste = emplacementsDe(sourceId);
    setEmplSourceId(liste.find((e) => e.code === 'MC')?.id ?? liste[0]?.id ?? '');

    // La destination doit suivre le changement de magasin de depart.
    // Sans cela, elle restait sur l'ancienne valeur : la liste deroulante
    // affichait un magasin et le bon partait vers un autre — ou vers le
    // magasin de depart lui-meme, ce que le serveur refusait sans que
    // l'ecran explique pourquoi.
    if (destinationId === sourceId || !magasins.some((m) => m.id === destinationId)) {
      setDestinationId(magasins.find((m) => m.id !== sourceId)?.id ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, magasins]);

  useEffect(() => {
    const liste = emplacementsDe(destinationId);
    setEmplDestId(liste.find((e) => e.code === 'MC')?.id ?? liste[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationId, magasins]);

  const ajouterArticle = (article: ArticleTrouve) => {
    if (lignes.some((l) => l.article.id === article.id)) {
      setErreur(
        `${article.designation} est deja sur le bon : modifiez sa quantite plutot que `
        + 'de l’ajouter une seconde fois.',
      );
      return;
    }
    setErreur(null);
    setLignes((l) => [...l, { article, quantite: '1' }]);
  };

  const creer = async () => {
    setErreur(null); setInfo(null); setOccupe(true);
    try {
      const bon = await appeler<Transfert>('/transferts', {
        methode: 'POST',
        corps: {
          magasinSourceId: sourceId,
          magasinDestinationId: destinationId,
          emplacementSourceId: emplSourceId,
          emplacementDestinationId: emplDestId,
          motif: motif || undefined,
          lignes: lignes.map((l) => ({
            articleId: l.article.id,
            quantiteMilli: Math.round(Number(l.quantite.replace(',', '.')) * 1000),
          })),
        },
      });
      setSaisie(false); setLignes([]); setMotif('');
      await charger();
      setInfo(
        `Bon ${bon.numero} prepare. Rien n’a encore bouge : expediez-le quand la `
        + 'marchandise part reellement.',
      );
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const expedier = async (t: Transfert) => {
    setErreur(null); setInfo(null); setOccupe(true);
    try {
      await appeler(`/transferts/${t.id}/expedition`, { methode: 'POST' });
      await charger();
      setInfo(
        `${t.numero} expedie. La marchandise est en transit : elle a quitte `
        + `${t.magasinSource.nom} et n’est pas encore a ${t.magasinDestination.nom}.`,
      );
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const ouvrirReception = (t: Transfert) => {
    setOuvert(t.id);
    // Pre-rempli avec la quantite annoncee : le cas courant est que tout
    // arrive. Le caissier corrige ce qui manque.
    setComptage(Object.fromEntries(
      t.lignes.map((l) => [l.articleId, String(l.quantiteMilli / 1000)]),
    ));
    setMotifsEcart({});
    setCommentaire('');
  };

  const receptionner = async (t: Transfert) => {
    setErreur(null); setInfo(null); setOccupe(true);
    try {
      const resultat = await appeler<Transfert>(`/transferts/${t.id}/reception`, {
        methode: 'POST',
        corps: {
          commentaire: commentaire || undefined,
          lignes: t.lignes.map((l) => ({
            articleId: l.articleId,
            quantiteRecueMilli: Math.round(
              Number((comptage[l.articleId] ?? '0').replace(',', '.')) * 1000,
            ),
            motifEcart: motifsEcart[l.articleId] || undefined,
          })),
        },
      });
      setOuvert(null);
      await charger();
      setInfo(resultat.avecEcart
        ? `${resultat.numeroReception} signe avec un ecart de `
          + `${formaterDA(Math.abs(resultat.valeurEcartCentimes))}. `
          + `L’ecart reste au compte de ${t.magasinSource.nom}.`
        : `${resultat.numeroReception} signe : tout est arrive.`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const annuler = async (t: Transfert) => {
    const raison = window.prompt(
      t.statut === 'EXPEDIE'
        ? `Annuler ${t.numero} ? La marchandise reviendra au depot de depart.\nMotif :`
        : `Annuler ${t.numero} ?\nMotif :`,
    );
    if (!raison || raison.trim().length < 3) return;
    setErreur(null); setInfo(null); setOccupe(true);
    try {
      await appeler(`/transferts/${t.id}/annulation`, {
        methode: 'POST', corps: { motif: raison.trim() },
      });
      await charger();
      setInfo(`${t.numero} annule.`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const enTransit = transferts.filter((t) => t.statut === 'EXPEDIE');
  const valeurEnRoute = enTransit.reduce((t, x) => t + x.valeurExpedieeCentimes, 0);

  const totalSaisi = lignes.reduce(
    (t, l) => t + (Number(l.quantite.replace(',', '.')) || 0), 0,
  );

  return (
    <>
      <div className="entete-page">
        <h1>Transferts entre magasins</h1>
        <span className="espace" />
        {peutGerer && !saisie && (
          <button className="principal" onClick={() => { setSaisie(true); setInfo(null); }}>
            Nouveau bon d’expedition
          </button>
        )}
      </div>

      <p className="discret">
        Un transfert se fait en deux temps : la marchandise part avec un bon d’expedition,
        puis elle est comptee a l’arrivee sur un bon de reception. Entre les deux elle est
        en transit — dans aucun rayon, mais toujours au compte du magasin expediteur.
      </p>

      {erreur && <div className="message erreur">{erreur}</div>}
      {info && <div className="message info">{info}</div>}

      {enTransit.length > 0 && (
        <div className="cartes" style={{ marginBottom: 16 }}>
          <div className="carte">
            <div className="intitule">Bons en transit</div>
            <div className="valeur">{enTransit.length}</div>
          </div>
          <div className="carte">
            <div className="intitule">Valeur sur la route</div>
            <div className="valeur">{formaterDA(valeurEnRoute)}</div>
          </div>
        </div>
      )}

      {saisie && (
        <div className="carte" style={{ marginBottom: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Nouveau bon d’expedition</h2>

          <div className="barre-outils">
            <div className="champ" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="source">Du magasin</label>
              <select id="source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                {magasins.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
              </select>
            </div>
            <div className="champ" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="empl-source">Emplacement de depart</label>
              <select id="empl-source" value={emplSourceId}
                onChange={(e) => setEmplSourceId(e.target.value)}>
                {emplacementsDe(sourceId).map((e) => (
                  <option key={e.id} value={e.id}>{e.nom}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="barre-outils">
            <div className="champ" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="destination">Vers le magasin</label>
              <select id="destination" value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}>
                {magasins.filter((m) => m.id !== sourceId).map((m) => (
                  <option key={m.id} value={m.id}>{m.nom}</option>
                ))}
              </select>
            </div>
            <div className="champ" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="empl-dest">Emplacement d’arrivee</label>
              <select id="empl-dest" value={emplDestId}
                onChange={(e) => setEmplDestId(e.target.value)}>
                {emplacementsDe(destinationId).map((e) => (
                  <option key={e.id} value={e.id}>{e.nom}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="champ">
            <label htmlFor="motif">Motif (facultatif)</label>
            <input id="motif" value={motif} onChange={(e) => setMotif(e.target.value)}
              placeholder="Reapprovisionnement, rupture signalee..." />
          </div>

          <div style={{ margin: '12px 0' }}>
            <label className="discret">Articles a expedier</label>
            <ChercheurArticle surChoix={ajouterArticle}
              placeholder="Scannez ou cherchez l’article a transferer" />
          </div>

          {lignes.length > 0 && (
            <div className="tableau" style={{ marginBottom: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Reference</th><th>Designation</th>
                    <th className="nombre">Quantite</th><th />
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l, i) => (
                    <tr key={l.article.id}>
                      <td>{l.article.reference}</td>
                      <td>{l.article.designation}</td>
                      <td className="nombre">
                        <input
                          inputMode="decimal" value={l.quantite}
                          style={{ width: 90, textAlign: 'right' }}
                          onChange={(e) => setLignes((liste) => liste.map(
                            (x, j) => (j === i ? { ...x, quantite: e.target.value } : x),
                          ))}
                        />{' '}
                        <span className="discret">{l.article.unite}</span>
                      </td>
                      <td>
                        <button onClick={() => setLignes(
                          (liste) => liste.filter((_, j) => j !== i),
                        )}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="barre-outils">
            <button onClick={() => { setSaisie(false); setLignes([]); }}>Annuler</button>
            <button
              className="principal"
              disabled={occupe || lignes.length === 0 || totalSaisi <= 0
                || !emplSourceId || !emplDestId}
              onClick={() => void creer()}
            >
              {occupe ? 'Enregistrement...' : 'Preparer le bon'}
            </button>
          </div>
        </div>
      )}

      <div className="barre-outils">
        {[['', 'Tous'], ['PREPARE', 'A expedier'], ['EXPEDIE', 'En transit'],
          ['RECU', 'Receptionnes'], ['ANNULE', 'Annules']].map(([valeur, libelle]) => (
          <button key={valeur} className={filtre === valeur ? 'principal' : ''}
            onClick={() => setFiltre(valeur)}>
            {libelle}
          </button>
        ))}
      </div>

      <div className="tableau">
        <table>
          <thead>
            <tr>
              <th>Bon</th><th>De</th><th>Vers</th>
              <th className="nombre">Lignes</th><th className="nombre">Valeur</th>
              <th>Etat</th><th>Date</th><th />
            </tr>
          </thead>
          <tbody>
            {transferts.map((t) => {
              const etat = ETATS[t.statut];
              return (
                <tr key={t.id}>
                  <td>
                    {t.numero}
                    {t.numeroReception && (
                      <div className="discret" style={{ fontSize: 12 }}>
                        reception {t.numeroReception}
                      </div>
                    )}
                  </td>
                  <td>{t.magasinSource.nom}<br />
                    <span className="discret" style={{ fontSize: 12 }}>
                      {t.emplacementSource.nom}
                    </span>
                  </td>
                  <td>{t.magasinDestination.nom}<br />
                    <span className="discret" style={{ fontSize: 12 }}>
                      {t.emplacementDestination.nom}
                    </span>
                  </td>
                  <td className="nombre">{t.lignes.length}</td>
                  <td className="nombre">{formaterDA(t.valeurExpedieeCentimes)}</td>
                  <td>
                    <span className={`etiquette ${etat.couleur}`}>{etat.texte}</span>
                    {t.avecEcart && (
                      <div className="discret" style={{ fontSize: 12, color: '#ff7b72' }}>
                        ecart {formaterDA(t.valeurEcartCentimes)}
                      </div>
                    )}
                  </td>
                  <td className="discret">
                    {formaterDate(t.recuLe ?? t.expedieLe ?? t.creeLe).slice(0, 10)}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {peutGerer && t.statut === 'PREPARE' && (
                      <>
                        <button disabled={occupe} onClick={() => void expedier(t)}>
                          Expedier
                        </button>{' '}
                        <button disabled={occupe} onClick={() => void annuler(t)}>×</button>
                      </>
                    )}
                    {peutGerer && t.statut === 'EXPEDIE' && (
                      <>
                        <button className="principal" disabled={occupe}
                          onClick={() => ouvrirReception(t)}>
                          Receptionner
                        </button>{' '}
                        <button disabled={occupe} onClick={() => void annuler(t)}>×</button>
                      </>
                    )}
                    {t.statut === 'RECU' && (
                      <button onClick={() => setOuvert(ouvert === t.id ? null : t.id)}>
                        Detail
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {transferts.length === 0 && (
              <tr>
                <td colSpan={8} className="discret centre" style={{ padding: 24 }}>
                  Aucun transfert.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {ouvert && (() => {
        const t = transferts.find((x) => x.id === ouvert);
        if (!t) return null;
        const enReception = t.statut === 'EXPEDIE';
        return (
          <div className="carte" style={{ marginTop: 24 }}>
            <div className="entete-page" style={{ marginBottom: 8 }}>
              <h2 style={{ fontSize: 18, margin: 0 }}>
                {enReception ? `Reception de ${t.numero}` : `Detail de ${t.numero}`}
              </h2>
              <span className="espace" />
              <button onClick={() => setOuvert(null)}>Fermer</button>
            </div>

            {enReception && (
              <p className="discret" style={{ marginTop: 0 }}>
                Comptez ce qui est reellement arrive. Les quantites sont pre-remplies avec
                ce qui a ete annonce ; corrigez ce qui manque. Tout ecart restera au
                compte de {t.magasinSource.nom}.
              </p>
            )}

            <div className="tableau">
              <table>
                <thead>
                  <tr>
                    <th>Reference</th><th>Designation</th>
                    <th className="nombre">Expedie</th>
                    <th className="nombre">{enReception ? 'Compte' : 'Recu'}</th>
                    <th className="nombre">Ecart</th>
                    <th>Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {t.lignes.map((l) => {
                    const compte = enReception
                      ? Math.round(
                        Number((comptage[l.articleId] ?? '0').replace(',', '.')) * 1000,
                      )
                      : (l.quantiteRecueMilli ?? 0);
                    const ecart = compte - l.quantiteMilli;
                    return (
                      <tr key={l.id}>
                        <td>{l.article.reference}</td>
                        <td>{l.article.designation}</td>
                        <td className="nombre">{QTE(l.quantiteMilli, l.article.unite)}</td>
                        <td className="nombre">
                          {enReception ? (
                            <input
                              inputMode="decimal"
                              style={{ width: 90, textAlign: 'right' }}
                              value={comptage[l.articleId] ?? ''}
                              onChange={(e) => setComptage(
                                (c) => ({ ...c, [l.articleId]: e.target.value }),
                              )}
                            />
                          ) : QTE(l.quantiteRecueMilli ?? 0, l.article.unite)}
                        </td>
                        <td className="nombre" style={{ color: ecart !== 0 ? '#ff7b72' : undefined }}>
                          {ecart === 0 ? '—' : QTE(ecart, l.article.unite)}
                        </td>
                        <td>
                          {enReception ? (
                            ecart !== 0 && (
                              <input
                                placeholder="Pourquoi ?"
                                value={motifsEcart[l.articleId] ?? ''}
                                onChange={(e) => setMotifsEcart(
                                  (m) => ({ ...m, [l.articleId]: e.target.value }),
                                )}
                              />
                            )
                          ) : (l.motifEcart ?? '—')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {enReception ? (
              <>
                <div className="champ" style={{ marginTop: 12 }}>
                  <label htmlFor="commentaire">Commentaire (facultatif)</label>
                  <input id="commentaire" value={commentaire}
                    onChange={(e) => setCommentaire(e.target.value)}
                    placeholder="Palette ouverte a l’arrivee, colis abime..." />
                </div>
                <div className="barre-outils" style={{ marginTop: 12 }}>
                  <button onClick={() => setOuvert(null)}>Annuler</button>
                  <button className="principal" disabled={occupe}
                    onClick={() => void receptionner(t)}>
                    {occupe ? 'Enregistrement...' : 'Signer le bon de reception'}
                  </button>
                </div>
              </>
            ) : (
              <p className="discret" style={{ marginBottom: 0 }}>
                Expedie par {t.expediePar?.nom ?? '—'} le {formaterDate(t.expedieLe ?? '')},
                recu par {t.recuPar?.nom ?? '—'} le {formaterDate(t.recuLe ?? '')}.
                {t.commentaireReception && ` « ${t.commentaireReception} »`}
              </p>
            )}
          </div>
        );
      })()}
    </>
  );
}
