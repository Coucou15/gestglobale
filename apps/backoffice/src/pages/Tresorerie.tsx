import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate } from '../client';
import type { Utilisateur } from '../Application';

interface Compte {
  id: string; code: string; libelle: string; type: string;
  magasin: { code: string; nom: string } | null; soldeCentimes: number;
}

interface Transfert {
  id: string; numero: string; montantCentimes: number; statut: string;
  motif: string | null; demandeLe: string;
  compteSource: { code: string; libelle: string };
  compteDestination: { code: string; libelle: string };
  demandePar: { code: string; nom: string };
  validePar: { code: string; nom: string } | null;
}

/** Categories proposees a la saisie, hors ecritures generees par le systeme. */
const CATEGORIES_SAISIE = [
  { valeur: 'DEPENSE', libelle: 'Depense (loyer, electricite, transport...)', sens: 'SORTIE' },
  { valeur: 'SALAIRE', libelle: 'Salaire', sens: 'SORTIE' },
  { valeur: 'AVANCE_SALAIRE', libelle: 'Avance sur salaire', sens: 'SORTIE' },
  { valeur: 'RETRAIT_GERANT', libelle: 'Retrait du gerant', sens: 'SORTIE' },
  { valeur: 'APPORT_GERANT', libelle: 'Apport du gerant', sens: 'ENTREE' },
  { valeur: 'AUTRE', libelle: 'Autre', sens: 'SORTIE' },
] as const;

interface Operation {
  id: string; numero: string; date: string; sens: string; categorie: string;
  montantCentimes: number; soldeApresCentimes: number; libelle: string; pointee: boolean;
  compte: { code: string; libelle: string };
  tiers: { raisonSociale: string } | null;
}

export function Tresorerie({ utilisateur }: { utilisateur: Utilisateur }) {
  const [situation, setSituation] = useState<{
    comptes: Compte[]; totalCentimes: number;
    parType: Array<{ type: string; soldeCentimes: number }>;
  } | null>(null);
  const [journal, setJournal] = useState<Operation[]>([]);
  const [compteId, setCompteId] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [transferts, setTransferts] = useState<Transfert[]>([]);
  const [occupe, setOccupe] = useState(false);
  const [vue, setVue] = useState<'journal' | 'saisie' | 'transferts'>('journal');

  // Saisie d'une operation.
  const [opCompteId, setOpCompteId] = useState('');
  const [opCategorie, setOpCategorie] = useState<string>('DEPENSE');
  const [opMontant, setOpMontant] = useState('');
  const [opLibelle, setOpLibelle] = useState('');

  // Demande de transfert.
  const [trSource, setTrSource] = useState('');
  const [trDestination, setTrDestination] = useState('');
  const [trMontant, setTrMontant] = useState('');
  const [trMotif, setTrMotif] = useState('');

  const peutSaisir = utilisateur.permissions.includes('tresorerie.saisir');
  const peutValiderTransfert = utilisateur.permissions.includes(
    'tresorerie.valider_transfert',
  );

  const charger = async () => {
    setErreur(null);
    try {
      const s = await appeler<{
        comptes: Compte[]; totalCentimes: number;
        parType: Array<{ type: string; soldeCentimes: number }>;
      }>('/tresorerie/situation');
      setSituation(s);
      if (!opCompteId && s.comptes[0]) setOpCompteId(s.comptes[0].id);
      if (!trSource && s.comptes[0]) setTrSource(s.comptes[0].id);
      if (!trDestination && s.comptes[1]) setTrDestination(s.comptes[1].id);

      const parametres = new URLSearchParams({ taille: '100' });
      if (compteId) parametres.set('compteId', compteId);
      setJournal(await appeler(`/tresorerie/journal?${parametres.toString()}`));
      setTransferts(await appeler<Transfert[]>('/tresorerie/transferts'));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compteId]);

  const enregistrerOperation = async () => {
    setErreur(null);
    setInfo(null);
    setOccupe(true);
    try {
      const categorie = CATEGORIES_SAISIE.find((c) => c.valeur === opCategorie);
      await appeler('/tresorerie/operations', {
        methode: 'POST',
        corps: {
          compteId: opCompteId,
          sens: categorie?.sens ?? 'SORTIE',
          categorie: opCategorie,
          montantCentimes: Math.round((Number(opMontant.replace(',', '.')) || 0) * 100),
          libelle: opLibelle,
        },
      });
      setInfo('Operation enregistree.');
      setOpMontant('');
      setOpLibelle('');
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  const demanderTransfert = async () => {
    setErreur(null);
    setInfo(null);
    setOccupe(true);
    try {
      await appeler('/tresorerie/transferts', {
        methode: 'POST',
        corps: {
          compteSourceId: trSource,
          compteDestinationId: trDestination,
          montantCentimes: Math.round((Number(trMontant.replace(',', '.')) || 0) * 100),
          motif: trMotif || undefined,
        },
      });
      setInfo('Transfert demande : il attend la validation d\u2019une autre personne.');
      setTrMontant('');
      setTrMotif('');
      setVue('transferts');
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  const validerTransfert = async (id: string) => {
    setErreur(null);
    setInfo(null);
    setOccupe(true);
    try {
      await appeler(`/tresorerie/transferts/${id}/valider`, { methode: 'POST' });
      setInfo('Transfert valide : l\u2019argent a ete deplace.');
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <>
      <div className="entete-page">
        <h1>Tresorerie</h1>
        <span className="espace" />
        <span className="discret">
          Total consolide : <strong>{formaterDA(situation?.totalCentimes)}</strong>
        </span>
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}
      {info && <div className="message info">{info}</div>}

      <div className="cartes">
        {(situation?.comptes ?? []).map((c) => (
          <div className="carte" key={c.id}>
            <div className="intitule">{c.libelle}</div>
            <div className="valeur">{formaterDA(c.soldeCentimes)}</div>
            <div className="detail">
              {c.type.toLowerCase()}{c.magasin ? ` — ${c.magasin.nom}` : ''}
            </div>
          </div>
        ))}
      </div>

      <div className="barre-outils" style={{ marginTop: 24 }}>
        <button className={vue === 'journal' ? 'principal' : ''} onClick={() => setVue('journal')}>
          Journal
        </button>
        {peutSaisir && (
          <button className={vue === 'saisie' ? 'principal' : ''} onClick={() => setVue('saisie')}>
            Saisir une operation
          </button>
        )}
        <button className={vue === 'transferts' ? 'principal' : ''} onClick={() => setVue('transferts')}>
          Transferts
          {transferts.filter((t) => t.statut === 'EN_ATTENTE').length > 0 && (
            <> <span className="etiquette orange">
              {transferts.filter((t) => t.statut === 'EN_ATTENTE').length}
            </span></>
          )}
        </button>
      </div>

      {vue === 'saisie' && peutSaisir && (
        <div className="carte" style={{ marginBottom: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Depense, salaire, apport ou retrait</h2>
          <div className="barre-outils">
            <select value={opCompteId} onChange={(e) => setOpCompteId(e.target.value)}>
              {(situation?.comptes ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.libelle} — {formaterDA(c.soldeCentimes)}
                </option>
              ))}
            </select>
            <select value={opCategorie} onChange={(e) => setOpCategorie(e.target.value)}>
              {CATEGORIES_SAISIE.map((c) => (
                <option key={c.valeur} value={c.valeur}>{c.libelle}</option>
              ))}
            </select>
            <input placeholder="Montant en DA" inputMode="decimal" value={opMontant}
              onChange={(e) => setOpMontant(e.target.value)} />
            <input placeholder="Libelle" value={opLibelle}
              onChange={(e) => setOpLibelle(e.target.value)} />
          </div>
          <p className="discret">
            Les apports et retraits du gerant correspondent aux ecritures
            « extra-commerciales » de l&apos;ancien logiciel.
          </p>
          <button
            className="principal"
            disabled={occupe || !opCompteId || !opLibelle.trim() || !opMontant.trim()}
            onClick={() => void enregistrerOperation()}
          >
            {occupe ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      )}

      {vue === 'transferts' && (
        <>
          {peutSaisir && (
            <div className="carte" style={{ marginBottom: 20 }}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>Demander un transfert</h2>
              <div className="barre-outils">
                <select value={trSource} onChange={(e) => setTrSource(e.target.value)}>
                  {(situation?.comptes ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      De : {c.libelle} — {formaterDA(c.soldeCentimes)}
                    </option>
                  ))}
                </select>
                <select value={trDestination} onChange={(e) => setTrDestination(e.target.value)}>
                  {(situation?.comptes ?? []).map((c) => (
                    <option key={c.id} value={c.id}>Vers : {c.libelle}</option>
                  ))}
                </select>
                <input placeholder="Montant en DA" inputMode="decimal" value={trMontant}
                  onChange={(e) => setTrMontant(e.target.value)} />
                <input placeholder="Motif" value={trMotif}
                  onChange={(e) => setTrMotif(e.target.value)} />
              </div>
              <p className="discret">
                L&apos;argent ne bouge qu&apos;apres validation par une autre personne : vous ne
                pouvez pas valider votre propre demande.
              </p>
              <button
                className="principal"
                disabled={occupe || !trMontant.trim() || trSource === trDestination}
                onClick={() => void demanderTransfert()}
              >
                {occupe ? 'Envoi...' : 'Demander le transfert'}
              </button>
            </div>
          )}

          <div className="tableau" style={{ marginBottom: 24 }}>
            <table>
              <thead>
                <tr>
                  <th>Numero</th><th>De</th><th>Vers</th>
                  <th className="nombre">Montant</th><th>Demande par</th>
                  <th>Statut</th><th />
                </tr>
              </thead>
              <tbody>
                {transferts.map((t) => (
                  <tr key={t.id}>
                    <td>{t.numero}</td>
                    <td>{t.compteSource.libelle}</td>
                    <td>{t.compteDestination.libelle}</td>
                    <td className="nombre">{formaterDA(t.montantCentimes)}</td>
                    <td className="discret">{t.demandePar.nom}</td>
                    <td>
                      <span className={`etiquette ${t.statut === 'VALIDE' ? 'vert'
                        : t.statut === 'REFUSE' ? 'rouge' : 'orange'}`}>
                        {t.statut.replace(/_/g, ' ').toLowerCase()}
                      </span>
                    </td>
                    <td>
                      {t.statut === 'EN_ATTENTE' && peutValiderTransfert && (
                        <button
                          disabled={occupe || t.demandePar.code === utilisateur.code}
                          title={t.demandePar.code === utilisateur.code
                            ? 'Vous avez demande ce transfert : une autre personne doit le valider'
                            : undefined}
                          onClick={() => void validerTransfert(t.id)}
                        >
                          Valider
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {transferts.length === 0 && (
                  <tr><td colSpan={7} className="discret">Aucun transfert</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {vue === 'journal' && (
      <>
      <div className="barre-outils">
        <select value={compteId} onChange={(e) => setCompteId(e.target.value)}>
          <option value="">Tous les comptes</option>
          {(situation?.comptes ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.libelle}</option>
          ))}
        </select>
      </div>

      <div className="tableau">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Compte</th><th>Libelle</th><th>Categorie</th>
              <th className="nombre">Montant</th><th className="nombre">Solde apres</th>
            </tr>
          </thead>
          <tbody>
            {journal.map((o) => (
              <tr key={o.id}>
                <td>{formaterDate(o.date)}</td>
                <td className="discret">{o.compte.libelle}</td>
                <td>{o.libelle}{o.tiers ? ` — ${o.tiers.raisonSociale}` : ''}</td>
                <td className="discret">{o.categorie.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="nombre" style={{ color: o.sens === 'ENTREE' ? 'var(--vert)' : 'var(--rouge)' }}>
                  {o.sens === 'ENTREE' ? '+' : '−'}{formaterDA(o.montantCentimes)}
                </td>
                <td className="nombre discret">{formaterDA(o.soldeApresCentimes)}</td>
              </tr>
            ))}
            {journal.length === 0 && (
              <tr><td colSpan={6} className="discret">Aucune operation</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </>
      )}
    </>
  );
}
