import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate } from '../client';
import { ChercheurArticle, type ArticleTrouve } from '../composants/ChercheurArticle';
import type { Utilisateur } from '../Application';

interface Promotion {
  id: string; code: string; libelle: string; type: string;
  debut: string; fin: string; actif: boolean; cumulable: boolean;
  valeurCentimes: number | null; remisePourcent: number | null;
  quantiteDeclenchement: number | null; quantiteOfferte: number | null;
  heureDebut: string | null; heureFin: string | null;
  article: { reference: string; designation: string } | null;
  famille: { code: string; nom: string } | null;
}

interface Famille { id: string; code: string; nom: string }

const TYPES = [
  { valeur: 'PRIX_BARRE', libelle: 'Prix barre', aide: 'Un article a un prix reduit' },
  { valeur: 'X_POUR_Y', libelle: 'X achetes, Y offerts', aide: 'Par exemple 2 achetes, 1 offert' },
  { valeur: 'REMISE_FAMILLE', libelle: 'Remise sur une famille', aide: 'Un pourcentage sur toute une famille' },
  { valeur: 'HAPPY_HOUR', libelle: 'Happy hour', aide: 'Une remise sur une plage horaire' },
];
const LIBELLE: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.valeur, t.libelle]));

/**
 * Promotions (M10).
 *
 * Declarees ici, appliquees par les caisses. Une promotion rejoint les
 * caisses a la synchronisation suivante, et s'applique ensuite meme sans
 * reseau.
 */
export function Promotions({ utilisateur }: { utilisateur: Utilisateur }) {
  const peutModifier = utilisateur.permissions.includes('article.modifier_prix_vente');
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [familles, setFamilles] = useState<Famille[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [saisie, setSaisie] = useState(false);

  const aujourdhui = new Date().toISOString().slice(0, 10);
  const dansUnMois = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [type, setType] = useState('PRIX_BARRE');
  const [code, setCode] = useState('');
  const [libelle, setLibelle] = useState('');
  const [debut, setDebut] = useState(aujourdhui);
  const [fin, setFin] = useState(dansUnMois);
  const [article, setArticle] = useState<ArticleTrouve | null>(null);
  const [familleId, setFamilleId] = useState('');
  const [prix, setPrix] = useState('');
  const [pourcent, setPourcent] = useState('10');
  const [achetes, setAchetes] = useState('2');
  const [offerts, setOfferts] = useState('1');
  const [heureDebut, setHeureDebut] = useState('18:00');
  const [heureFin, setHeureFin] = useState('20:00');
  const [cumulable, setCumulable] = useState(false);

  const charger = async () => {
    setErreur(null);
    try {
      setPromotions(await appeler<Promotion[]>('/promotions'));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void charger();
    void appeler<Famille[]>('/referentiel/familles').then(setFamilles).catch(() => undefined);
  }, []);

  const creer = async () => {
    setErreur(null); setInfo(null); setOccupe(true);
    try {
      await appeler('/promotions', {
        methode: 'POST',
        corps: {
          code, libelle, type,
          debut: new Date(`${debut}T00:00:00`).toISOString(),
          fin: new Date(`${fin}T23:59:59`).toISOString(),
          ...(type === 'PRIX_BARRE' || type === 'X_POUR_Y'
            ? { articleId: article?.id }
            : {}),
          ...(type === 'REMISE_FAMILLE' || type === 'HAPPY_HOUR'
            ? { familleId: familleId || undefined }
            : {}),
          ...(type === 'PRIX_BARRE'
            ? { valeurCentimes: Math.round((Number(prix.replace(',', '.')) || 0) * 100) }
            : {}),
          ...(type === 'REMISE_FAMILLE' || type === 'HAPPY_HOUR'
            ? { remisePourcent: Number(pourcent) || 0 }
            : {}),
          ...(type === 'X_POUR_Y'
            ? { quantiteDeclenchement: Number(achetes) || 0, quantiteOfferte: Number(offerts) || 0 }
            : {}),
          ...(type === 'HAPPY_HOUR' ? { heureDebut, heureFin } : {}),
          cumulable,
        },
      });
      setSaisie(false); setCode(''); setLibelle(''); setArticle(null);
      await charger();
      setInfo('Promotion creee : les caisses l’appliqueront a leur prochaine synchronisation.');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const basculer = async (p: Promotion) => {
    setErreur(null); setOccupe(true);
    try {
      await appeler(`/promotions/${p.id}`, { methode: 'PATCH', corps: { actif: !p.actif } });
      await charger();
      setInfo(p.actif ? `« ${p.libelle} » suspendue.` : `« ${p.libelle} » activee.`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const retirer = async (p: Promotion) => {
    setErreur(null); setInfo(null); setOccupe(true);
    try {
      const r = await appeler<{ supprimee: boolean; message?: string }>(
        `/promotions/${p.id}`, { methode: 'DELETE' },
      );
      await charger();
      setInfo(r.message ?? 'Promotion supprimee.');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const enCours = (p: Promotion) => {
    const maintenant = Date.now();
    return p.actif && new Date(p.debut).getTime() <= maintenant
      && new Date(p.fin).getTime() >= maintenant;
  };

  const detail = (p: Promotion) => {
    switch (p.type) {
      case 'PRIX_BARRE':
        return `${p.article?.designation ?? '?'} a ${formaterDA(p.valeurCentimes ?? 0)}`;
      case 'X_POUR_Y':
        return `${p.quantiteDeclenchement} achete(s), ${p.quantiteOfferte} offert(s) — ` +
          `${p.article?.designation ?? '?'}`;
      case 'REMISE_FAMILLE':
        return `-${p.remisePourcent} % sur ${p.famille?.nom ?? 'tout le catalogue'}`;
      case 'HAPPY_HOUR':
        return `-${p.remisePourcent} % de ${p.heureDebut} a ${p.heureFin}` +
          (p.famille ? ` sur ${p.famille.nom}` : '');
      default:
        return '';
    }
  };

  const typeChoisi = TYPES.find((t) => t.valeur === type);

  // On remet les champs a leur valeur neutre en changeant de type, pour
  // ne pas trainer un article choisi pour une promotion d'une autre sorte.
  const changerType = (nouveau: string) => {
    setType(nouveau);
    setArticle(null);
    setFamilleId('');
  };

  return (
    <>
      <div className="entete-page">
        <h1>Promotions</h1>
        <span className="espace" />
        {peutModifier && !saisie && (
          <button className="principal" onClick={() => setSaisie(true)}>Nouvelle promotion</button>
        )}
      </div>

      <p className="discret">
        Les caisses appliquent ces promotions seules, meme sans reseau. Une promotion creee ou
        suspendue les rejoint a la synchronisation suivante.
      </p>

      {erreur && <div className="message erreur">{erreur}</div>}
      {info && <div className="message info">{info}</div>}

      {saisie && (
        <div className="carte" style={{ marginBottom: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Nouvelle promotion</h2>

          <div className="barre-outils">
            <select value={type} onChange={(e) => changerType(e.target.value)}>
              {TYPES.map((t) => <option key={t.valeur} value={t.valeur}>{t.libelle}</option>)}
            </select>
            <input placeholder="Code (ex. PROMO-HUILE)" value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <input placeholder="Libelle imprime sur le ticket" value={libelle}
              onChange={(e) => setLibelle(e.target.value)} />
          </div>
          <p className="discret" style={{ marginTop: 0 }}>{typeChoisi?.aide}</p>

          <div className="barre-outils">
            <div className="champ" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="debut">Du</label>
              <input id="debut" type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
            </div>
            <div className="champ" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="fin">Au</label>
              <input id="fin" type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
            </div>
          </div>

          {(type === 'PRIX_BARRE' || type === 'X_POUR_Y') && (
            <div style={{ margin: '12px 0' }}>
              <label className="discret">Article vise</label>
              {article ? (
                <div className="rangee" style={{ gap: 10, marginTop: 6 }}>
                  <strong>{article.designation}</strong>
                  <span className="discret">{article.reference}</span>
                  <button onClick={() => setArticle(null)}>Changer</button>
                </div>
              ) : (
                <ChercheurArticle surChoix={setArticle}
                  placeholder="Scannez ou cherchez l'article en promotion" />
              )}
            </div>
          )}

          {(type === 'REMISE_FAMILLE' || type === 'HAPPY_HOUR') && (
            <div className="champ">
              <label htmlFor="famille">
                {type === 'REMISE_FAMILLE' ? 'Famille visee' : 'Famille visee (facultatif)'}
              </label>
              <select id="famille" value={familleId} onChange={(e) => setFamilleId(e.target.value)}>
                {/* Une remise « par famille » en exige une ; une happy hour
                    peut couvrir tout le magasin. */}
                {type === 'REMISE_FAMILLE'
                  ? <option value="">— Choisir une famille —</option>
                  : <option value="">Tout le catalogue</option>}
                {familles.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
              </select>
            </div>
          )}

          <div className="barre-outils">
            {type === 'PRIX_BARRE' && (
              <input placeholder="Prix promotionnel en DA" inputMode="decimal"
                value={prix} onChange={(e) => setPrix(e.target.value)} />
            )}
            {(type === 'REMISE_FAMILLE' || type === 'HAPPY_HOUR') && (
              <input placeholder="Remise en %" inputMode="numeric"
                value={pourcent} onChange={(e) => setPourcent(e.target.value)} />
            )}
            {type === 'X_POUR_Y' && (
              <>
                <input placeholder="Achetes" inputMode="numeric"
                  value={achetes} onChange={(e) => setAchetes(e.target.value)} />
                <input placeholder="Offerts" inputMode="numeric"
                  value={offerts} onChange={(e) => setOfferts(e.target.value)} />
              </>
            )}
            {type === 'HAPPY_HOUR' && (
              <>
                <input type="time" value={heureDebut} onChange={(e) => setHeureDebut(e.target.value)} />
                <input type="time" value={heureFin} onChange={(e) => setHeureFin(e.target.value)} />
              </>
            )}
          </div>

          <label className="rangee" style={{ gap: 10, margin: '12px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={cumulable} style={{ width: 20, minHeight: 20 }}
              onChange={(e) => setCumulable(e.target.checked)} />
            <span>
              Cumulable avec une autre promotion
              <span className="discret"> — sinon seule la plus avantageuse s&apos;applique</span>
            </span>
          </label>

          <div className="barre-outils">
            <button onClick={() => setSaisie(false)}>Annuler</button>
            <button
              className="principal"
              disabled={
                occupe || !code || !libelle ||
                ((type === 'PRIX_BARRE' || type === 'X_POUR_Y') && !article) ||
                (type === 'REMISE_FAMILLE' && !familleId)
              }
              onClick={() => void creer()}
            >
              {occupe ? 'Enregistrement...' : 'Creer la promotion'}
            </button>
          </div>
        </div>
      )}

      <div className="tableau">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Libelle</th><th>Type</th><th>Detail</th>
              <th>Periode</th><th>Etat</th><th />
            </tr>
          </thead>
          <tbody>
            {promotions.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td>
                <td>
                  {p.libelle}
                  {p.cumulable && <> <span className="etiquette neutre">cumulable</span></>}
                </td>
                <td className="discret">{LIBELLE[p.type] ?? p.type}</td>
                <td>{detail(p)}</td>
                <td className="discret">
                  {formaterDate(p.debut).slice(0, 10)} → {formaterDate(p.fin).slice(0, 10)}
                </td>
                <td>
                  <span className={`etiquette ${enCours(p) ? 'vert' : p.actif ? 'orange' : 'neutre'}`}>
                    {enCours(p) ? 'en cours' : p.actif ? 'programmee' : 'suspendue'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {peutModifier && (
                    <>
                      <button disabled={occupe} onClick={() => void basculer(p)}>
                        {p.actif ? 'Suspendre' : 'Activer'}
                      </button>{' '}
                      <button disabled={occupe} onClick={() => void retirer(p)}>×</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {promotions.length === 0 && (
              <tr><td colSpan={7} className="discret">Aucune promotion</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
