import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate, formaterQuantite } from '../client';
import { ChercheurArticle, type ArticleTrouve } from '../composants/ChercheurArticle';
import { useReferentiel } from '../composants/referentiel';
import type { Utilisateur } from '../Application';
import { ChoixMagasin } from '../composants/ChoixMagasin';

interface InventaireListe {
  id: string; numero: string; type: string; statut: string; libelle: string | null;
  debuteLe: string; clotureLe: string | null; ecartValoriseCentimes: number;
  emplacement: { code: string; nom: string };
  utilisateurSaisie: { code: string; nom: string };
  utilisateurValidation: { code: string; nom: string } | null;
  _count: { lignes: number };
}

interface Etat {
  inventaire: InventaireListe;
  avancement: { comptees: number; total: number; restantes: number };
  ecarts: Array<{
    id: string; quantiteTheoriqueMilli: number; quantiteCompteeMilli: number | null;
    ecartMilli: number; ecartValoriseCentimes: number;
    article: { reference: string; designation: string; unite: string };
  }>;
}

interface Comptage {
  article: ArticleTrouve;
  quantite: string;
}

/**
 * Inventaire tournant ou complet.
 *
 * La saisie ne touche jamais le stock : c'est la validation par un
 * responsable qui genere les ajustements. Le magasinier compte, le gerant
 * signe en connaissance de l'ecart valorise (M2 et section 6).
 */
export function Inventaires({ utilisateur }: { utilisateur: Utilisateur }) {
  const { magasins, pret } = useReferentiel();
  const [liste, setListe] = useState<InventaireListe[]>([]);
  const [etat, setEtat] = useState<Etat | null>(null);
  const [comptages, setComptages] = useState<Comptage[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const [ouverture, setOuverture] = useState(false);
  const [emplacementId, setEmplacementId] = useState('');
  const [type, setType] = useState<'TOURNANT' | 'COMPLET'>('TOURNANT');
  const [libelle, setLibelle] = useState('');

  // Le magasin est choisi, jamais devine : voir ChoixMagasin.
  const [magasinId, setMagasinId] = useState('');
  const magasin = magasins.find((m) => m.id === magasinId) ?? magasins[0];

  useEffect(() => {
    if (!magasinId && magasins.length > 0) setMagasinId(magasins[0].id);
  }, [magasins, magasinId]);
  const peutValider = utilisateur.permissions.includes('stock.inventaire_valider');

  const charger = async () => {
    setErreur(null);
    try {
      setListe(await appeler<InventaireListe[]>('/stocks/inventaires'));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { void charger(); }, []);

  useEffect(() => {
    if (!emplacementId && magasin?.emplacements[0]) {
      setEmplacementId(magasin.emplacements[0].id);
    }
  }, [magasin, emplacementId]);

  const ouvrir = async () => {
    setErreur(null);
    setOccupe(true);
    try {
      const cree = await appeler<{ id: string }>('/stocks/inventaires', {
        methode: 'POST',
        corps: { emplacementId, type, libelle: libelle || undefined },
      });
      setOuverture(false);
      setLibelle('');
      await charger();
      await ouvrirEtat(cree.id);
      setInfo('Inventaire ouvert : les quantites theoriques sont figees.');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  const ouvrirEtat = async (id: string) => {
    setErreur(null);
    setComptages([]);
    try {
      setEtat(await appeler<Etat>(`/stocks/inventaires/${id}`));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  const envoyerComptage = async () => {
    if (!etat) return;
    setErreur(null);
    setOccupe(true);
    try {
      const resultat = await appeler<{ traitees: number }>(
        `/stocks/inventaires/${etat.inventaire.id}/comptage`,
        {
          methode: 'POST',
          corps: {
            source: 'back-office',
            lignes: comptages.map((c) => ({
              articleId: c.article.id,
              quantiteCompteeMilli: Math.round(
                (Number(c.quantite.replace(',', '.')) || 0) * 1000,
              ),
            })),
          },
        },
      );
      setInfo(`${resultat.traitees} ligne(s) comptee(s).`);
      setComptages([]);
      await ouvrirEtat(etat.inventaire.id);
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  const valider = async () => {
    if (!etat) return;
    setErreur(null);
    setOccupe(true);
    try {
      const resultat = await appeler<{ ajustements: number; ecartValoriseCentimes: number }>(
        `/stocks/inventaires/${etat.inventaire.id}/valider`,
        { methode: 'POST' },
      );
      setInfo(
        `Inventaire valide : ${resultat.ajustements} ajustement(s) de stock, ` +
        `ecart valorise ${formaterDA(resultat.ecartValoriseCentimes)}.`,
      );
      setEtat(null);
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  if (!pret) return <div className="discret">Chargement du referentiel...</div>;
  if (!magasin) return <div className="message erreur">Aucun magasin accessible.</div>;

  return (
    <>
      <div className="entete-page">
        <h1>Inventaires</h1>
        <span className="espace" />
        {!ouverture && !etat && (
          <button className="principal" onClick={() => setOuverture(true)}>
            Ouvrir un inventaire
          </button>
        )}
        {etat && <button onClick={() => setEtat(null)}>Retour a la liste</button>}
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}
      {info && <div className="message info">{info}</div>}

      {ouverture && (
        <div className="carte" style={{ marginBottom: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Nouvel inventaire</h2>

          <div className="barre-outils">
            <ChoixMagasin magasins={magasins} valeur={magasin?.id ?? ''}
              surChoix={setMagasinId} />
          </div>
          <div className="barre-outils">
            <select id="emplacement" value={emplacementId}
              onChange={(e) => setEmplacementId(e.target.value)}>
              {magasin.emplacements.map((e) => (
                <option key={e.id} value={e.id}>{e.nom}</option>
              ))}
            </select>
            <select id="type-inventaire" value={type}
              onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="TOURNANT">Tournant — seulement les articles en stock</option>
              <option value="COMPLET">Complet — tout le catalogue</option>
            </select>
            <input placeholder="Libelle (facultatif)" value={libelle}
              onChange={(e) => setLibelle(e.target.value)} />
          </div>
          <p className="discret">
            A l&apos;ouverture, les quantites theoriques sont figees. Un seul inventaire peut
            etre en cours par emplacement.
          </p>
          <div className="barre-outils">
            <button onClick={() => setOuverture(false)}>Annuler</button>
            <button className="principal" disabled={occupe} onClick={() => void ouvrir()}>
              {occupe ? 'Ouverture...' : 'Ouvrir'}
            </button>
          </div>
        </div>
      )}

      {etat ? (
        <>
          <div className="cartes" style={{ marginBottom: 20 }}>
            <div className="carte">
              <div className="intitule">Inventaire</div>
              <div className="valeur" style={{ fontSize: 20 }}>{etat.inventaire.numero}</div>
              <div className="detail">
                {etat.inventaire.emplacement.nom} — {etat.inventaire.type.toLowerCase()}
              </div>
            </div>
            <div className="carte">
              <div className="intitule">Avancement</div>
              <div className="valeur">
                {etat.avancement.comptees} / {etat.avancement.total}
              </div>
              <div className="detail">{etat.avancement.restantes} ligne(s) restante(s)</div>
            </div>
            <div className="carte">
              <div className="intitule">Ecart valorise</div>
              <div
                className="valeur"
                style={{
                  color: etat.inventaire.ecartValoriseCentimes === 0
                    ? 'var(--vert)' : 'var(--orange)',
                }}
              >
                {formaterDA(etat.inventaire.ecartValoriseCentimes)}
              </div>
              <div className="detail">au cout moyen pondere</div>
            </div>
          </div>

          {etat.inventaire.statut !== 'VALIDE' && (
            <div className="carte" style={{ marginBottom: 20 }}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>Saisie du comptage</h2>
              <ChercheurArticle
                surChoix={(article) =>
                  setComptages((c) =>
                    c.some((x) => x.article.id === article.id)
                      ? c
                      : [...c, { article, quantite: '' }],
                  )
                }
                placeholder="Scannez l'article compte"
              />

              {comptages.length > 0 && (
                <>
                  <div className="tableau" style={{ marginTop: 16 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Article</th>
                          <th className="nombre" style={{ width: 160 }}>Quantite comptee</th>
                          <th style={{ width: 50 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {comptages.map((c, i) => (
                          <tr key={c.article.id}>
                            <td>
                              {c.article.designation}
                              <br />
                              <span className="discret">
                                {c.article.reference} — {c.article.unite}
                              </span>
                            </td>
                            <td>
                              <input
                                autoFocus={i === comptages.length - 1}
                                value={c.quantite}
                                inputMode="decimal"
                                style={{ textAlign: 'right', minHeight: 38, padding: 8 }}
                                onChange={(e) =>
                                  setComptages((liste) =>
                                    liste.map((x, j) =>
                                      j === i ? { ...x, quantite: e.target.value } : x,
                                    ),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <button
                                onClick={() =>
                                  setComptages((liste) => liste.filter((_, j) => j !== i))
                                }
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="barre-outils" style={{ marginTop: 16 }}>
                    <button onClick={() => setComptages([])}>Vider</button>
                    <button
                      className="principal"
                      disabled={occupe || comptages.some((c) => c.quantite.trim() === '')}
                      onClick={() => void envoyerComptage()}
                    >
                      {occupe ? 'Envoi...' : `Enregistrer ${comptages.length} comptage(s)`}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <h2 style={{ fontSize: 18 }}>Ecarts constates</h2>
          <div className="tableau">
            <table>
              <thead>
                <tr>
                  <th>Reference</th><th>Designation</th>
                  <th className="nombre">Theorique</th><th className="nombre">Compte</th>
                  <th className="nombre">Ecart</th><th className="nombre">Valorise</th>
                </tr>
              </thead>
              <tbody>
                {etat.ecarts.map((e) => (
                  <tr key={e.id}>
                    <td>{e.article.reference}</td>
                    <td>{e.article.designation}</td>
                    <td className="nombre discret">
                      {formaterQuantite(e.quantiteTheoriqueMilli, e.article.unite === 'UN' ? 0 : 3)}
                    </td>
                    <td className="nombre">
                      {formaterQuantite(e.quantiteCompteeMilli ?? 0, e.article.unite === 'UN' ? 0 : 3)}
                    </td>
                    <td className="nombre" style={{ color: e.ecartMilli < 0 ? 'var(--rouge)' : 'var(--vert)' }}>
                      {e.ecartMilli > 0 ? '+' : ''}
                      {formaterQuantite(e.ecartMilli, e.article.unite === 'UN' ? 0 : 3)}
                    </td>
                    <td className="nombre">{formaterDA(e.ecartValoriseCentimes)}</td>
                  </tr>
                ))}
                {etat.ecarts.length === 0 && (
                  <tr><td colSpan={6} className="discret">Aucun ecart pour l&apos;instant</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {etat.inventaire.statut !== 'VALIDE' && (
            <div className="carte" style={{ marginTop: 20 }}>
              {peutValider ? (
                <>
                  <div className="message info">
                    La validation genere un mouvement d&apos;ajustement par ligne en ecart. Elle
                    est definitive et tracee a votre nom.
                  </div>
                  <button
                    className="principal"
                    disabled={occupe || etat.avancement.comptees === 0}
                    onClick={() => void valider()}
                  >
                    {occupe ? 'Validation...' : 'Valider l’inventaire et ajuster le stock'}
                  </button>
                </>
              ) : (
                <div className="message attention" style={{
                  background: 'rgba(210,153,34,.15)', border: '1px solid var(--orange)',
                }}>
                  Vous pouvez saisir le comptage, mais seul un responsable peut valider
                  l&apos;inventaire et ajuster le stock.
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="tableau">
          <table>
            <thead>
              <tr>
                <th>Numero</th><th>Emplacement</th><th>Type</th><th>Ouvert le</th>
                <th>Saisi par</th><th className="nombre">Lignes</th>
                <th className="nombre">Ecart</th><th>Statut</th><th />
              </tr>
            </thead>
            <tbody>
              {liste.map((i) => (
                <tr key={i.id}>
                  <td>{i.numero}</td>
                  <td>{i.emplacement.nom}</td>
                  <td className="discret">{i.type.toLowerCase()}</td>
                  <td>{formaterDate(i.debuteLe)}</td>
                  <td className="discret">{i.utilisateurSaisie.nom}</td>
                  <td className="nombre">{i._count.lignes}</td>
                  <td className="nombre">{formaterDA(i.ecartValoriseCentimes)}</td>
                  <td>
                    <span className={`etiquette ${i.statut === 'VALIDE' ? 'vert'
                      : i.statut === 'ANNULE' ? 'neutre' : 'orange'}`}>
                      {i.statut.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => void ouvrirEtat(i.id)}>
                      {i.statut === 'VALIDE' ? 'Consulter' : 'Ouvrir'}
                    </button>
                  </td>
                </tr>
              ))}
              {liste.length === 0 && (
                <tr><td colSpan={9} className="discret">Aucun inventaire</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
