import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate } from '../client';

interface Compte {
  id: string; code: string; libelle: string; type: string;
  magasin: { code: string; nom: string } | null; soldeCentimes: number;
}

interface Operation {
  id: string; numero: string; date: string; sens: string; categorie: string;
  montantCentimes: number; soldeApresCentimes: number; libelle: string; pointee: boolean;
  compte: { code: string; libelle: string };
  tiers: { raisonSociale: string } | null;
}

export function Tresorerie() {
  const [situation, setSituation] = useState<{
    comptes: Compte[]; totalCentimes: number;
    parType: Array<{ type: string; soldeCentimes: number }>;
  } | null>(null);
  const [journal, setJournal] = useState<Operation[]>([]);
  const [compteId, setCompteId] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const charger = async () => {
      setErreur(null);
      try {
        setSituation(await appeler('/tresorerie/situation'));
        const parametres = new URLSearchParams({ taille: '100' });
        if (compteId) parametres.set('compteId', compteId);
        setJournal(await appeler(`/tresorerie/journal?${parametres.toString()}`));
      } catch (e) {
        setErreur(e instanceof Error ? e.message : String(e));
      }
    };
    void charger();
  }, [compteId]);

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
  );
}
