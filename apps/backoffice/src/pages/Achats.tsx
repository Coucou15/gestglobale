import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate, formaterQuantite } from '../client';
import { ChercheurArticle, type ArticleTrouve } from '../composants/ChercheurArticle';
import { useReferentiel } from '../composants/referentiel';
import type { Utilisateur } from '../Application';

interface Reception {
  id: string; numero: string; type: string; statut: string;
  dateReception: string; totalTtcCentimes: number;
  fournisseur: { code: string; raisonSociale: string };
  emplacement: { code: string; nom: string };
  _count: { lignes: number };
}

interface LigneSaisie {
  article: ArticleTrouve;
  quantite: string;
  prixAchat: string;
  remise: string;
  lotNumero: string;
  datePeremption: string;
}

interface DetailReception {
  id: string; numero: string; statut: string;
  totalHtCentimes: number; totalTtcCentimes: number;
  fournisseur: { raisonSociale: string };
  lignes: Array<{
    id: string; quantiteMilli: number; prixAchatCentimes: number; remisePourcent: number;
    cumpAvantCentimes: number; prixVenteProposeCentimes: number | null;
    article: { reference: string; designation: string; unite: string };
  }>;
}

const vide = (article: ArticleTrouve): LigneSaisie => ({
  article,
  quantite: '1',
  prixAchat: ((article.dernierPrixAchatCentimes ?? article.cumpCentimes ?? 0) / 100)
    .toFixed(2).replace('.', ','),
  remise: '0',
  lotNumero: '',
  datePeremption: '',
});

function enCentimes(valeur: string): number {
  const n = Number(valeur.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function enMilli(valeur: string): number {
  const n = Number(valeur.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 1000) : 0;
}

/**
 * Reception fournisseur.
 *
 * La reception se cree en brouillon : rien ne bouge en stock. C'est la
 * validation qui fait entrer la marchandise, recalcule le CUMP et cree
 * la dette ou sort l'argent du tiroir. Le brouillon permet de verifier
 * les prix de vente proposes avant de s'engager.
 */
export function Achats({ utilisateur }: { utilisateur: Utilisateur }) {
  // La validation au comptant a besoin des comptes ; le droit de
  // receptionner s'accompagne de celui de voir la tresorerie chez
  // l'acheteur et le gerant.
  const voitTresorerie = utilisateur.permissions.includes('tresorerie.voir');
  const { magasins, comptes, pret } = useReferentiel({ avecComptes: voitTresorerie });
  const [receptions, setReceptions] = useState<Reception[]>([]);
  const [fournisseurs, setFournisseurs] = useState<Array<{ id: string; code: string; raisonSociale: string }>>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [enSaisie, setEnSaisie] = useState(false);
  const [fournisseurId, setFournisseurId] = useState('');
  const [emplacementId, setEmplacementId] = useState('');
  const [numeroBon, setNumeroBon] = useState('');
  const [lignes, setLignes] = useState<LigneSaisie[]>([]);
  const [enregistrement, setEnregistrement] = useState(false);

  const [detail, setDetail] = useState<DetailReception | null>(null);
  const [modeReglement, setModeReglement] = useState<'COMPTANT' | 'CREDIT'>('CREDIT');
  const [compteId, setCompteId] = useState('');
  const [dateEcheance, setDateEcheance] = useState('');
  const [appliquerPrix, setAppliquerPrix] = useState(true);

  const magasin = magasins[0];
  const peutRecevoir = utilisateur.permissions.includes('stock.reception');

  const charger = async () => {
    setErreur(null);
    try {
      setReceptions(await appeler<Reception[]>('/achats/receptions'));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { void charger(); }, []);

  useEffect(() => {
    void appeler<{ tiers: Array<{ id: string; code: string; raisonSociale: string }> }>(
      '/tiers?type=FOURNISSEUR&taille=200',
    ).then((r) => setFournisseurs(r.tiers)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!emplacementId && magasin) {
      const parDefaut = magasin.emplacements.find((e) => e.parDefautReception)
        ?? magasin.emplacements[0];
      if (parDefaut) setEmplacementId(parDefaut.id);
    }
  }, [magasin, emplacementId]);

  const totalSaisi = lignes.reduce((t, l) => {
    const brut = (enMilli(l.quantite) * enCentimes(l.prixAchat)) / 1000;
    return t + Math.round(brut * (1 - (Number(l.remise.replace(',', '.')) || 0) / 100));
  }, 0);

  const creer = async () => {
    setErreur(null);
    setInfo(null);
    setEnregistrement(true);
    try {
      const reception = await appeler<{ id: string }>('/achats/receptions', {
        methode: 'POST',
        corps: {
          fournisseurId,
          magasinId: magasin.id,
          emplacementId,
          numeroBonFournisseur: numeroBon || undefined,
          lignes: lignes.map((l) => ({
            articleId: l.article.id,
            quantiteMilli: enMilli(l.quantite),
            prixAchatCentimes: enCentimes(l.prixAchat),
            remisePourcent: Math.round(Number(l.remise.replace(',', '.')) || 0),
            tauxTva: l.article.tauxTva,
            ...(l.lotNumero ? { lotNumero: l.lotNumero } : {}),
            ...(l.datePeremption ? { datePeremption: l.datePeremption } : {}),
          })),
        },
      });
      setEnSaisie(false);
      setLignes([]);
      setNumeroBon('');
      await charger();
      await ouvrirDetail(reception.id);
      setInfo('Reception enregistree en brouillon : verifiez les prix proposes avant de valider.');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnregistrement(false);
    }
  };

  const ouvrirDetail = async (id: string) => {
    setErreur(null);
    try {
      setDetail(await appeler<DetailReception>(`/achats/receptions/${id}`));
      setCompteId(comptes.find((c) => c.type === 'TIROIR')?.id ?? comptes[0]?.id ?? '');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  const valider = async () => {
    if (!detail) return;
    setErreur(null);
    setEnregistrement(true);
    try {
      await appeler(`/achats/receptions/${detail.id}/valider`, {
        methode: 'POST',
        corps: {
          modeReglement,
          ...(modeReglement === 'COMPTANT' ? { compteId } : {}),
          ...(dateEcheance ? { dateEcheance } : {}),
          appliquerPrixVente: appliquerPrix,
        },
      });
      setInfo(`Reception ${detail.numero} validee : stock entre et CUMP recalcule.`);
      setDetail(null);
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnregistrement(false);
    }
  };

  if (!pret) return <div className="discret">Chargement du referentiel...</div>;
  if (!magasin) return <div className="message erreur">Aucun magasin accessible.</div>;

  return (
    <>
      <div className="entete-page">
        <h1>Receptions fournisseur</h1>
        <span className="espace" />
        {peutRecevoir && !enSaisie && (
          <button className="principal" onClick={() => setEnSaisie(true)}>
            Nouvelle reception
          </button>
        )}
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}
      {info && <div className="message info">{info}</div>}

      {enSaisie && (
        <div className="carte" style={{ marginBottom: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Nouvelle reception</h2>

          <div className="barre-outils">
            <select value={fournisseurId} onChange={(e) => setFournisseurId(e.target.value)}>
              <option value="">— Choisir un fournisseur —</option>
              {fournisseurs.map((f) => (
                <option key={f.id} value={f.id}>{f.code} — {f.raisonSociale}</option>
              ))}
            </select>
            <select value={emplacementId} onChange={(e) => setEmplacementId(e.target.value)}>
              {magasin.emplacements.map((e) => (
                <option key={e.id} value={e.id}>{e.nom}</option>
              ))}
            </select>
            <input
              placeholder="N° du bon de livraison fournisseur"
              value={numeroBon}
              onChange={(e) => setNumeroBon(e.target.value)}
            />
          </div>

          <div style={{ margin: '16px 0' }}>
            <ChercheurArticle
              surChoix={(article) => {
                setLignes((l) =>
                  l.some((x) => x.article.id === article.id) ? l : [...l, vide(article)],
                );
              }}
              placeholder="Scannez ou cherchez l'article a receptionner"
            />
          </div>

          {lignes.length > 0 && (
            <div className="tableau">
              <table>
                <thead>
                  <tr>
                    <th>Article</th>
                    <th className="nombre" style={{ width: 110 }}>Quantite</th>
                    <th className="nombre" style={{ width: 130 }}>Prix d&apos;achat</th>
                    <th className="nombre" style={{ width: 90 }}>Remise %</th>
                    <th style={{ width: 120 }}>Lot</th>
                    <th style={{ width: 150 }}>Peremption</th>
                    <th className="nombre">Total HT</th>
                    <th style={{ width: 50 }} />
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l, i) => {
                    const brut = (enMilli(l.quantite) * enCentimes(l.prixAchat)) / 1000;
                    const total = Math.round(
                      brut * (1 - (Number(l.remise.replace(',', '.')) || 0) / 100),
                    );
                    const modifier = (champ: keyof LigneSaisie, valeur: string) =>
                      setLignes((liste) =>
                        liste.map((x, j) => (j === i ? { ...x, [champ]: valeur } : x)),
                      );
                    return (
                      <tr key={l.article.id}>
                        <td>
                          {l.article.designation}
                          <br />
                          <span className="discret">{l.article.reference} — {l.article.unite}</span>
                        </td>
                        <td>
                          <input value={l.quantite} inputMode="decimal"
                            style={{ textAlign: 'right', minHeight: 38, padding: 8 }}
                            onChange={(e) => modifier('quantite', e.target.value)} />
                        </td>
                        <td>
                          <input value={l.prixAchat} inputMode="decimal"
                            style={{ textAlign: 'right', minHeight: 38, padding: 8 }}
                            onChange={(e) => modifier('prixAchat', e.target.value)} />
                        </td>
                        <td>
                          <input value={l.remise} inputMode="decimal"
                            style={{ textAlign: 'right', minHeight: 38, padding: 8 }}
                            onChange={(e) => modifier('remise', e.target.value)} />
                        </td>
                        <td>
                          <input value={l.lotNumero} placeholder="—"
                            style={{ minHeight: 38, padding: 8 }}
                            onChange={(e) => modifier('lotNumero', e.target.value)} />
                        </td>
                        <td>
                          <input type="date" value={l.datePeremption}
                            style={{ minHeight: 38, padding: 8 }}
                            onChange={(e) => modifier('datePeremption', e.target.value)} />
                        </td>
                        <td className="nombre">{formaterDA(total)}</td>
                        <td>
                          <button onClick={() => setLignes((liste) => liste.filter((_, j) => j !== i))}>
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="barre-outils" style={{ marginTop: 16, alignItems: 'center' }}>
            <strong style={{ fontSize: 18 }}>Total HT : {formaterDA(totalSaisi)}</strong>
            <span className="espace" style={{ flex: 1 }} />
            <button onClick={() => { setEnSaisie(false); setLignes([]); }}>Annuler</button>
            <button
              className="principal"
              disabled={!fournisseurId || !emplacementId || lignes.length === 0 || enregistrement}
              onClick={() => void creer()}
            >
              {enregistrement ? 'Enregistrement...' : 'Enregistrer en brouillon'}
            </button>
          </div>
        </div>
      )}

      {detail && (
        <div className="voile" onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modale">
            <h2>Valider la reception {detail.numero}</h2>
            <p className="discret">
              {detail.fournisseur.raisonSociale} — {formaterDA(detail.totalTtcCentimes)}
            </p>

            <div className="tableau" style={{ marginBottom: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Article</th>
                    <th className="nombre">Quantite</th>
                    <th className="nombre">CUMP avant</th>
                    <th className="nombre">Prix de vente propose</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lignes.map((l) => (
                    <tr key={l.id}>
                      <td>{l.article.designation}</td>
                      <td className="nombre">
                        {formaterQuantite(l.quantiteMilli, l.article.unite === 'UN' ? 0 : 3)}
                      </td>
                      <td className="nombre discret">{formaterDA(l.cumpAvantCentimes)}</td>
                      <td className="nombre">
                        {l.prixVenteProposeCentimes
                          ? formaterDA(l.prixVenteProposeCentimes)
                          : <span className="discret">inchange</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="champ">
              <label>Reglement</label>
              <div className="barre-outils">
                <button
                  className={modeReglement === 'CREDIT' ? 'principal' : ''}
                  onClick={() => setModeReglement('CREDIT')}
                >
                  A credit
                </button>
                <button
                  className={modeReglement === 'COMPTANT' ? 'principal' : ''}
                  disabled={!voitTresorerie}
                  title={voitTresorerie ? undefined : 'Reserve aux roles ayant acces a la tresorerie'}
                  onClick={() => setModeReglement('COMPTANT')}
                >
                  Au comptant
                </button>
              </div>
            </div>

            {modeReglement === 'COMPTANT' && comptes.length === 0 ? (
              <div className="message erreur">
                Aucun compte de tresorerie accessible : demandez a un responsable de valider
                cette reception au comptant, ou choisissez le credit.
              </div>
            ) : modeReglement === 'COMPTANT' ? (
              <div className="champ">
                <label htmlFor="compte">Compte debite</label>
                <select id="compte" value={compteId} onChange={(e) => setCompteId(e.target.value)}>
                  {comptes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.libelle} — {formaterDA(c.soldeCentimes)}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="champ">
                <label htmlFor="echeance">Echeance de paiement</label>
                <input id="echeance" type="date" value={dateEcheance}
                  onChange={(e) => setDateEcheance(e.target.value)} />
              </div>
            )}

            <label className="rangee" style={{ gap: 10, marginBottom: 16, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={appliquerPrix}
                style={{ width: 20, minHeight: 20 }}
                onChange={(e) => setAppliquerPrix(e.target.checked)}
              />
              <span>Appliquer les nouveaux prix de vente proposes</span>
            </label>

            <div className="message info">
              La validation est definitive : elle fait entrer le stock, recalcule le CUMP et
              {modeReglement === 'COMPTANT'
                ? ' sort l’argent du compte choisi.'
                : ' cree la dette fournisseur.'}
            </div>

            <div className="barre-outils">
              <button style={{ flex: 1 }} onClick={() => setDetail(null)}>Fermer</button>
              <button
                className="principal"
                style={{ flex: 2 }}
                disabled={enregistrement || (modeReglement === 'COMPTANT' && !compteId)}
                onClick={() => void valider()}
              >
                {enregistrement ? 'Validation...' : 'Valider la reception'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="tableau">
        <table>
          <thead>
            <tr>
              <th>Numero</th><th>Date</th><th>Fournisseur</th><th>Emplacement</th>
              <th className="nombre">Lignes</th><th className="nombre">Total</th>
              <th>Statut</th><th />
            </tr>
          </thead>
          <tbody>
            {receptions.map((r) => (
              <tr key={r.id}>
                <td>{r.numero}</td>
                <td>{formaterDate(r.dateReception)}</td>
                <td>{r.fournisseur.raisonSociale}</td>
                <td className="discret">{r.emplacement.nom}</td>
                <td className="nombre">{r._count.lignes}</td>
                <td className="nombre">{formaterDA(r.totalTtcCentimes)}</td>
                <td>
                  <span className={`etiquette ${r.statut === 'VALIDEE' ? 'vert' : 'orange'}`}>
                    {r.statut.toLowerCase()}
                  </span>
                </td>
                <td>
                  {r.statut === 'BROUILLON' && peutRecevoir && (
                    <button onClick={() => void ouvrirDetail(r.id)}>Valider</button>
                  )}
                </td>
              </tr>
            ))}
            {receptions.length === 0 && (
              <tr><td colSpan={8} className="discret">Aucune reception</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
