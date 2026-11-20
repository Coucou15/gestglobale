import { useEffect, useState } from 'react';
import { appeler, formaterDate } from '../client';

interface Entree {
  id: string; numero: number; date: string; action: string;
  entite: string | null; poste: string | null; adresseIp: string | null;
  details: Record<string, unknown> | null;
  utilisateur: { code: string; nom: string } | null;
}

/**
 * Journal d'audit non modifiable (section 6).
 * Le controle d'integrite recalcule la chaine d'empreintes : il detecte
 * toute ligne retouchee ou supprimee directement en base.
 */
export function Audit() {
  const [entrees, setEntrees] = useState<Entree[]>([]);
  const [action, setAction] = useState('');
  const [integrite, setIntegrite] = useState<{ intact: boolean; ruptureAuNumero: string | null } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const charger = async () => {
      setErreur(null);
      try {
        const parametres = new URLSearchParams({ taille: '100' });
        if (action.trim()) parametres.set('action', action.trim());
        const reponse = await appeler<{ lignes: Entree[] }>(`/audit?${parametres.toString()}`);
        setEntrees(reponse.lignes);
      } catch (e) {
        setErreur(e instanceof Error ? e.message : String(e));
      }
    };
    const minuterie = setTimeout(() => void charger(), 300);
    return () => clearTimeout(minuterie);
  }, [action]);

  const verifier = async () => {
    setIntegrite(null);
    try {
      setIntegrite(await appeler('/audit/integrite'));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="entete-page">
        <h1>Journal d&apos;audit</h1>
        <span className="espace" />
        <button onClick={() => void verifier()}>Verifier l&apos;integrite</button>
      </div>

      {integrite && (
        <div className={`message ${integrite.intact ? 'info' : 'erreur'}`}>
          {integrite.intact
            ? 'La chaine d’empreintes est intacte : aucune ligne n’a ete retouchee.'
            : `Chaine rompue a l’entree n° ${integrite.ruptureAuNumero} : une ligne a ete modifiee ou supprimee directement en base.`}
        </div>
      )}

      {erreur && <div className="message erreur">{erreur}</div>}

      <div className="barre-outils">
        <input
          placeholder="Filtrer par action (connexion, vente, article...)"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
      </div>

      <div className="tableau">
        <table>
          <thead>
            <tr>
              <th className="nombre">N°</th><th>Date</th><th>Utilisateur</th>
              <th>Action</th><th>Entite</th><th>Poste / IP</th>
            </tr>
          </thead>
          <tbody>
            {entrees.map((e) => (
              <tr key={e.id}>
                <td className="nombre discret">{e.numero}</td>
                <td>{formaterDate(e.date)}</td>
                <td>{e.utilisateur ? `${e.utilisateur.nom} (${e.utilisateur.code})` : '—'}</td>
                <td>{e.action}</td>
                <td className="discret">{e.entite ?? '—'}</td>
                <td className="discret">{e.poste ?? e.adresseIp ?? '—'}</td>
              </tr>
            ))}
            {entrees.length === 0 && <tr><td colSpan={6} className="discret">Aucune entree</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
