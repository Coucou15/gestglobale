import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate } from '../client';
import type { Utilisateur } from '../Application';

interface Utilisation {
  documentNumero: string; montantCentimes: number;
  decouvertCentimes: number; horsLigne: boolean; date: string;
}

interface Bon {
  id: string; code: string; type: string;
  montantCentimes: number; soldeCentimes: number;
  expireLe: string | null; utilise: boolean; actif: boolean;
  motifAnnulation: string | null; creeLe: string;
  client: { code: string; raisonSociale: string } | null;
  utilisations: Utilisation[];
}

interface Decouvert {
  documentNumero: string;
  /** Part effectivement prelevee sur le bon. */
  montantCentimes: number;
  /** Part que le bon ne couvrait pas : c'est le manque. */
  decouvertCentimes: number;
  horsLigne: boolean;
  date: string;
  bon: { code: string; type: string; montantCentimes: number };
}

interface ClientTrouve {
  id: string; code: string; raisonSociale: string; carteFidelite: string | null;
}

interface Bareme {
  actif: boolean; centimesParPoint: number;
  valeurPointCentimes: number; minimumUtilisation: number;
}

const TYPES = [
  {
    valeur: 'CARTE_CADEAU', libelle: 'Carte cadeau',
    aide: 'Vendue ou offerte, utilisable par qui la presente',
  },
  {
    valeur: 'BON_ACHAT', libelle: 'Bon d’achat',
    aide: 'Geste commercial, ou avoir remis apres un retour',
  },
];
const LIBELLE_TYPE: Record<string, string> =
  Object.fromEntries(TYPES.map((t) => [t.valeur, t.libelle]));

/**
 * Fidelite, cartes cadeaux et bons d'achat (M10).
 *
 * Un bon est de l'argent au porteur. La caisse l'accepte meme sans
 * reseau, sur le solde connu a sa derniere synchronisation : si deux
 * caisses hors ligne acceptent le meme bon, il est depense deux fois. La
 * vente tient — la marchandise est partie — et le depassement est
 * signale dans le rapport en bas de cet ecran.
 */
export function Fidelite({ utilisateur }: { utilisateur: Utilisateur }) {
  const peutEmettre = utilisateur.permissions.includes('tiers.modifier');
  const peutAnnuler = utilisateur.permissions.includes('tiers.bloquer');
  const voitDecouverts = utilisateur.permissions.includes('tresorerie.voir');

  const [bons, setBons] = useState<Bon[]>([]);
  const [decouverts, setDecouverts] = useState<Decouvert[]>([]);
  const [bareme, setBareme] = useState<Bareme | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [saisie, setSaisie] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [actifsSeuls, setActifsSeuls] = useState(true);
  const [emis, setEmis] = useState<Bon[] | null>(null);

  const [conversion, setConversion] = useState(false);
  const [rechercheClient, setRechercheClient] = useState('');
  const [clientsTrouves, setClientsTrouves] = useState<ClientTrouve[]>([]);
  const [client, setClient] = useState<ClientTrouve | null>(null);
  const [pointsClient, setPointsClient] = useState<{ points: number; valeurCentimes: number } | null>(null);
  const [pointsAConvertir, setPointsAConvertir] = useState('');

  const dansUnAn = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const [type, setType] = useState('CARTE_CADEAU');
  const [montant, setMontant] = useState('1000');
  const [nombre, setNombre] = useState('1');
  const [expireLe, setExpireLe] = useState(dansUnAn);
  const [sansExpiration, setSansExpiration] = useState(false);

  const charger = async (codeCherche = recherche) => {
    setErreur(null);
    try {
      const parametres = new URLSearchParams();
      if (actifsSeuls) parametres.set('actifs', 'true');
      if (codeCherche.trim()) parametres.set('code', codeCherche.trim());
      setBons(await appeler<Bon[]>(`/fidelite/bons?${parametres.toString()}`));
      if (voitDecouverts) {
        setDecouverts(await appeler<Decouvert[]>('/fidelite/bons/decouverts?jours=90'));
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void charger();
    void appeler<Bareme>('/fidelite/bareme').then(setBareme).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actifsSeuls]);

  useEffect(() => {
    if (client || rechercheClient.trim().length < 2) { setClientsTrouves([]); return; }
    const minuterie = setTimeout(() => {
      const parametres = new URLSearchParams({
        type: 'CLIENT', taille: '20', texte: rechercheClient.trim(),
      });
      void appeler<{ tiers: ClientTrouve[] }>(`/tiers?${parametres.toString()}`)
        .then((r) => setClientsTrouves(r.tiers))
        .catch(() => setClientsTrouves([]));
    }, 300);
    return () => clearTimeout(minuterie);
  }, [rechercheClient, client]);

  const choisirClient = async (c: ClientTrouve) => {
    setClient(c);
    setClientsTrouves([]);
    setRechercheClient('');
    setPointsClient(null);
    try {
      const p = await appeler<{ points: number; valeurCentimes: number }>(
        `/fidelite/points/${c.id}`,
      );
      setPointsClient(p);
      setPointsAConvertir(String(p.points));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  const convertir = async () => {
    if (!client) return;
    setErreur(null); setInfo(null); setEmis(null); setOccupe(true);
    try {
      const resultat = await appeler<{
        bon: Bon; points: number; montantCentimes: number; pointsRestants: number;
      }>(`/fidelite/points/${client.id}/conversion`, {
        methode: 'POST',
        corps: { points: Number(pointsAConvertir) || 0 },
      });
      setEmis([resultat.bon]);
      setConversion(false);
      setInfo(
        `${resultat.points} points de ${client.raisonSociale} convertis en bon `
        + `${resultat.bon.code} de ${formaterDA(resultat.montantCentimes)}. `
        + `Reste ${resultat.pointsRestants} point${resultat.pointsRestants > 1 ? 's' : ''}.`,
      );
      setClient(null); setPointsClient(null); setPointsAConvertir('');
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const emettre = async () => {
    setErreur(null); setInfo(null); setEmis(null); setOccupe(true);
    try {
      const centimes = Math.round((Number(montant.replace(',', '.')) || 0) * 100);
      const creees = await appeler<Bon[]>('/fidelite/bons', {
        methode: 'POST',
        corps: {
          type,
          montantCentimes: centimes,
          nombre: Number(nombre) || 1,
          ...(sansExpiration
            ? {}
            : { expireLe: new Date(`${expireLe}T23:59:59`).toISOString() }),
        },
      });
      setEmis(creees);
      setSaisie(false);
      await charger();
      setInfo(
        `${creees.length} ${creees.length > 1 ? 'bons emis' : 'bon emis'} de `
        + `${formaterDA(centimes)}. Les caisses les accepteront a leur prochaine `
        + 'synchronisation.',
      );
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const annuler = async (bon: Bon) => {
    const motif = window.prompt(
      `Annuler ${bon.code} (solde ${formaterDA(bon.soldeCentimes)}) ?\n`
      + 'Motif : perdu, vole, emis par erreur...',
    );
    if (!motif || motif.trim().length < 3) return;
    setErreur(null); setInfo(null); setOccupe(true);
    try {
      await appeler(`/fidelite/bons/${bon.id}/annulation`, {
        methode: 'POST', corps: { motif: motif.trim() },
      });
      await charger();
      setInfo(
        `${bon.code} annule. Une caisse hors ligne peut encore l’accepter jusqu’a sa `
        + 'prochaine synchronisation : le depassement apparaitra dans le rapport.',
      );
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const etat = (bon: Bon) => {
    if (!bon.actif) return { texte: 'annule', couleur: 'rouge' };
    if (bon.soldeCentimes <= 0) return { texte: 'epuise', couleur: 'neutre' };
    if (bon.expireLe && new Date(bon.expireLe).getTime() < Date.now()) {
      return { texte: 'expire', couleur: 'orange' };
    }
    if (bon.soldeCentimes < bon.montantCentimes) {
      return { texte: 'entame', couleur: 'orange' };
    }
    return { texte: 'valable', couleur: 'vert' };
  };

  const enCirculation = bons
    .filter((b) => b.actif && b.soldeCentimes > 0)
    .reduce((somme, b) => somme + b.soldeCentimes, 0);
  const totalDecouvert = decouverts.reduce((s, d) => s + d.decouvertCentimes, 0);

  return (
    <>
      <div className="entete-page">
        <h1>Fidelite et bons d’achat</h1>
        <span className="espace" />
        {peutEmettre && !conversion && (
          <button onClick={() => { setConversion(true); setSaisie(false); setEmis(null); }}>
            Convertir des points
          </button>
        )}
        {peutEmettre && !saisie && (
          <button
            className="principal"
            onClick={() => { setSaisie(true); setConversion(false); setEmis(null); }}
          >
            Emettre des bons
          </button>
        )}
      </div>

      {bareme && (
        <p className="discret">
          {bareme.actif
            ? <>
                Un point par {formaterDA(bareme.centimesParPoint)} d’achat. Un point vaut{' '}
                {formaterDA(bareme.valeurPointCentimes)}, a partir de{' '}
                {bareme.minimumUtilisation} points cumules.
              </>
            : <>
                La fidelite est desactivee : les tickets ne creditent aucun point.
                Les bons d’achat fonctionnent quand meme.
              </>}
        </p>
      )}

      {erreur && <div className="message erreur">{erreur}</div>}
      {info && <div className="message info">{info}</div>}

      {conversion && (
        <div className="carte" style={{ marginBottom: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Convertir des points en bon</h2>
          <p className="discret" style={{ marginTop: 0 }}>
            Les points ne paient pas directement : ils deviennent un bon, qui porte un code
            et une trace. Le bon rejoint ensuite les caisses, qui l’acceptent meme sans reseau.
          </p>

          <div className="champ">
            <label htmlFor="client">Client (nom, code ou carte de fidelite)</label>
            {client ? (
              <div className="barre-outils" style={{ marginBottom: 0 }}>
                <strong style={{ alignSelf: 'center' }}>{client.raisonSociale}</strong>
                <span className="discret" style={{ alignSelf: 'center' }}>{client.code}</span>
                <button onClick={() => { setClient(null); setPointsClient(null); }}>
                  Changer
                </button>
              </div>
            ) : (
              <input
                id="client" value={rechercheClient}
                placeholder="Au moins deux caracteres"
                onChange={(e) => setRechercheClient(e.target.value)}
              />
            )}
            {clientsTrouves.length > 0 && !client && (
              <div className="tableau" style={{ marginTop: 8, maxHeight: 200, overflow: 'auto' }}>
                <table>
                  <tbody>
                    {clientsTrouves.map((c) => (
                      <tr
                        key={c.id} style={{ cursor: 'pointer' }}
                        onClick={() => void choisirClient(c)}
                      >
                        <td>{c.raisonSociale}</td>
                        <td className="discret">{c.code}</td>
                        <td className="discret">{c.carteFidelite ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {pointsClient && (
            <>
              <p>
                <strong>{pointsClient.points}</strong> point
                {pointsClient.points > 1 ? 's' : ''} —{' '}
                <strong>{formaterDA(pointsClient.valeurCentimes)}</strong>
                {bareme && pointsClient.points < bareme.minimumUtilisation && (
                  <span className="discret">
                    {' '}— il en faut {bareme.minimumUtilisation} pour obtenir un bon
                  </span>
                )}
              </p>
              <div className="barre-outils">
                <input
                  inputMode="numeric" placeholder="Points a convertir"
                  value={pointsAConvertir}
                  onChange={(e) => setPointsAConvertir(e.target.value)}
                />
                <button onClick={() => setConversion(false)}>Annuler</button>
                <button
                  className="principal"
                  disabled={
                    occupe
                    || !pointsClient.points
                    || Number(pointsAConvertir) <= 0
                    || Number(pointsAConvertir) > pointsClient.points
                  }
                  onClick={() => void convertir()}
                >
                  {occupe ? 'Conversion...' : 'Convertir'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {saisie && (
        <div className="carte" style={{ marginBottom: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Emission</h2>

          <div className="barre-outils">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t.valeur} value={t.valeur}>{t.libelle}</option>)}
            </select>
            <input
              placeholder="Montant en DA" inputMode="decimal"
              value={montant} onChange={(e) => setMontant(e.target.value)}
            />
            <input
              placeholder="Nombre de bons" inputMode="numeric"
              value={nombre} onChange={(e) => setNombre(e.target.value)}
            />
          </div>
          <p className="discret" style={{ marginTop: 0 }}>
            {TYPES.find((t) => t.valeur === type)?.aide} — jusqu’a 200 bons d’un coup,
            numerotes a la suite.
          </p>

          <div className="champ" style={{ maxWidth: 260 }}>
            <label htmlFor="expiration">Valable jusqu’au</label>
            <input
              id="expiration" type="date" value={expireLe} disabled={sansExpiration}
              onChange={(e) => setExpireLe(e.target.value)}
            />
          </div>

          <label style={{ display: 'flex', gap: 10, margin: '12px 0', cursor: 'pointer' }}>
            <input
              type="checkbox" checked={sansExpiration} style={{ width: 20, minHeight: 20 }}
              onChange={(e) => setSansExpiration(e.target.checked)}
            />
            <span>
              Sans expiration
              <span className="discret"> — le bon reste du indefiniment</span>
            </span>
          </label>

          <div className="barre-outils">
            <button onClick={() => setSaisie(false)}>Annuler</button>
            <button
              className="principal"
              disabled={occupe || !montant || Number(montant.replace(',', '.')) <= 0}
              onClick={() => void emettre()}
            >
              {occupe ? 'Emission...' : 'Emettre'}
            </button>
          </div>
        </div>
      )}

      {emis && emis.length > 0 && (
        <div className="carte" style={{ marginBottom: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Codes a remettre aux clients</h2>
          <p className="discret" style={{ marginTop: 0 }}>
            Notez-les ou imprimez cette page : le code est ce que la caisse demande.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
            {emis.map((b) => (
              <li key={b.id}>
                <strong style={{ fontFamily: 'monospace' }}>{b.code}</strong>
                {' — '}{formaterDA(b.montantCentimes)}
                {b.expireLe
                  ? ` — jusqu’au ${formaterDate(b.expireLe).slice(0, 10)}`
                  : ' — sans expiration'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="barre-outils">
        <input
          placeholder="Chercher un code" value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void charger(); }}
        />
        <button onClick={() => void charger()}>Chercher</button>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox" checked={actifsSeuls} style={{ width: 20, minHeight: 20 }}
            onChange={(e) => setActifsSeuls(e.target.checked)}
          />
          <span>Valables seulement</span>
        </label>
        <span className="espace" />
        <span className="discret" style={{ alignSelf: 'center' }}>
          {formaterDA(enCirculation)} en circulation
        </span>
      </div>

      <div className="tableau">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Type</th>
              <th className="nombre">Montant</th><th className="nombre">Solde</th>
              <th>Expire</th><th>Etat</th><th>Utilisation</th><th />
            </tr>
          </thead>
          <tbody>
            {bons.map((bon) => {
              const e = etat(bon);
              const depassement = bon.utilisations.reduce((s, u) => s + u.decouvertCentimes, 0);
              return (
                <tr key={bon.id}>
                  <td style={{ fontFamily: 'monospace' }}>{bon.code}</td>
                  <td className="discret">{LIBELLE_TYPE[bon.type] ?? bon.type}</td>
                  <td className="nombre">{formaterDA(bon.montantCentimes)}</td>
                  <td className="nombre">{formaterDA(bon.soldeCentimes)}</td>
                  <td className="discret">
                    {bon.expireLe ? formaterDate(bon.expireLe).slice(0, 10) : '—'}
                  </td>
                  <td>
                    <span className={`etiquette ${e.couleur}`}>{e.texte}</span>
                    {bon.motifAnnulation && (
                      <div className="discret" style={{ fontSize: 12 }}>{bon.motifAnnulation}</div>
                    )}
                  </td>
                  <td className="discret" style={{ fontSize: 12 }}>
                    {bon.utilisations.length === 0
                      ? 'jamais presente'
                      : bon.utilisations.map((u) => (
                        <div key={u.documentNumero}>
                          {u.documentNumero} — {formaterDA(u.montantCentimes)}
                          {u.horsLigne ? ' (hors ligne)' : ''}
                        </div>
                      ))}
                    {depassement > 0 && (
                      <div style={{ color: '#ff7b72' }}>
                        depassement {formaterDA(depassement)}
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {peutAnnuler && bon.actif && bon.soldeCentimes > 0 && (
                      <button disabled={occupe} onClick={() => void annuler(bon)}>Annuler</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {bons.length === 0 && (
              <tr>
                <td colSpan={8} className="discret centre" style={{ padding: 24 }}>
                  Aucun bon.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {voitDecouverts && (
        <>
          <div className="entete-page" style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 18 }}>Bons presentes au-dela de leur solde</h2>
          </div>
          <p className="discret">
            Sans reseau, une caisse ne connait que le solde de sa derniere synchronisation :
            un bon deja depense ailleurs peut etre accepte une seconde fois. La vente tient,
            et le manque apparait ici.
          </p>
          {decouverts.length === 0 ? (
            <p className="discret">Aucun depassement sur les 90 derniers jours.</p>
          ) : (
            <div className="tableau">
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Bon</th><th>Document</th>
                    <th className="nombre">Presente</th><th className="nombre">Non couvert</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {decouverts.map((d) => (
                    <tr key={`${d.bon.code}-${d.documentNumero}`}>
                      <td className="discret">{formaterDate(d.date).slice(0, 10)}</td>
                      <td style={{ fontFamily: 'monospace' }}>{d.bon.code}</td>
                      <td>{d.documentNumero}</td>
                      <td className="nombre">
                        {formaterDA(d.montantCentimes + d.decouvertCentimes)}
                      </td>
                      <td className="nombre" style={{ color: '#ff7b72' }}>
                        {formaterDA(d.decouvertCentimes)}
                      </td>
                      <td className="discret">{d.horsLigne ? 'hors ligne' : 'en ligne'}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4}><strong>Total non couvert</strong></td>
                    <td className="nombre"><strong>{formaterDA(totalDecouvert)}</strong></td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
