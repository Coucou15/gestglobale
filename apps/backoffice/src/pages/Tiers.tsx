import { useEffect, useState } from 'react';
import { appeler, formaterDA } from '../client';

interface Tiers {
  id: string; code: string; type: string; raisonSociale: string;
  telephone: string | null; soldeCentimes: number; plafondCreditCentimes: number;
  bloque: boolean; motifBlocage: string | null; carteFidelite: string | null;
}

interface Impaye {
  id: string; documentNumero: string; dateEcheance: string;
  resteDuCentimes: number; joursRetard: number;
  tiers: { code: string; raisonSociale: string; telephone: string | null };
}

export function Tiers() {
  const [onglet, setOnglet] = useState<'CLIENT' | 'FOURNISSEUR' | 'IMPAYES'>('CLIENT');
  const [texte, setTexte] = useState('');
  const [liste, setListe] = useState<Tiers[]>([]);
  const [impayes, setImpayes] = useState<Impaye[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const charger = async () => {
      setErreur(null);
      try {
        if (onglet === 'IMPAYES') {
          setImpayes(await appeler('/tiers/impayes'));
          return;
        }
        const parametres = new URLSearchParams({ type: onglet, taille: '100' });
        if (texte.trim()) parametres.set('texte', texte.trim());
        const reponse = await appeler<{ tiers: Tiers[] }>(`/tiers?${parametres.toString()}`);
        setListe(reponse.tiers);
      } catch (e) {
        setErreur(e instanceof Error ? e.message : String(e));
      }
    };
    const minuterie = setTimeout(() => void charger(), 300);
    return () => clearTimeout(minuterie);
  }, [onglet, texte]);

  return (
    <>
      <div className="entete-page">
        <h1>Clients et fournisseurs</h1>
      </div>

      <div className="barre-outils">
        <button className={onglet === 'CLIENT' ? 'principal' : ''} onClick={() => setOnglet('CLIENT')}>
          Clients
        </button>
        <button className={onglet === 'FOURNISSEUR' ? 'principal' : ''} onClick={() => setOnglet('FOURNISSEUR')}>
          Fournisseurs
        </button>
        <button className={onglet === 'IMPAYES' ? 'principal' : ''} onClick={() => setOnglet('IMPAYES')}>
          Impayes
        </button>
        {onglet !== 'IMPAYES' && (
          <input
            placeholder="Nom, code, telephone ou carte"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
          />
        )}
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}

      {onglet !== 'IMPAYES' ? (
        <div className="tableau">
          <table>
            <thead>
              <tr>
                <th>Code</th><th>Raison sociale</th><th>Telephone</th>
                <th className="nombre">Solde</th><th className="nombre">Plafond</th><th>Etat</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((t) => (
                <tr key={t.id}>
                  <td>{t.code}</td>
                  <td>
                    {t.raisonSociale}
                    {t.carteFidelite && <> <span className="etiquette neutre">{t.carteFidelite}</span></>}
                  </td>
                  <td className="discret">{t.telephone ?? '—'}</td>
                  <td className="nombre">{formaterDA(t.soldeCentimes)}</td>
                  <td className="nombre discret">
                    {t.plafondCreditCentimes > 0 ? formaterDA(t.plafondCreditCentimes) : '—'}
                  </td>
                  <td>
                    {t.bloque ? (
                      <span className="etiquette rouge" title={t.motifBlocage ?? ''}>bloque</span>
                    ) : t.plafondCreditCentimes > 0 && t.soldeCentimes >= t.plafondCreditCentimes ? (
                      <span className="etiquette orange">plafond atteint</span>
                    ) : (
                      <span className="etiquette vert">normal</span>
                    )}
                  </td>
                </tr>
              ))}
              {liste.length === 0 && <tr><td colSpan={6} className="discret">Aucun resultat</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="tableau">
          <table>
            <thead>
              <tr>
                <th>Client</th><th>Telephone</th><th>Document</th>
                <th className="nombre">Reste du</th><th className="nombre">Retard</th>
              </tr>
            </thead>
            <tbody>
              {impayes.map((i) => (
                <tr key={i.id}>
                  <td>{i.tiers.raisonSociale}</td>
                  <td className="discret">{i.tiers.telephone ?? '—'}</td>
                  <td>{i.documentNumero}</td>
                  <td className="nombre">{formaterDA(i.resteDuCentimes)}</td>
                  <td className="nombre">
                    <span className={`etiquette ${i.joursRetard > 30 ? 'rouge' : 'orange'}`}>
                      {i.joursRetard} j
                    </span>
                  </td>
                </tr>
              ))}
              {impayes.length === 0 && <tr><td colSpan={5} className="discret">Aucun impaye</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
