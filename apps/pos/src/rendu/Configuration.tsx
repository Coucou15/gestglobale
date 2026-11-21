import { useState } from 'react';

interface ApiConfiguration {
  configuration(): Promise<{ configuree: boolean; chemin: string }>;
  testerServeur(url: string): Promise<{ joignable: boolean; message?: string }>;
  enregistrerConfiguration(saisie: unknown): Promise<{ configuree: boolean }>;
}

/**
 * Premiere installation du poste.
 *
 * L'installateur qui deploie plusieurs caisses saisit ici l'adresse du
 * serveur et l'identite du poste, plutot que d'editer un fichier JSON sur
 * chaque machine. Les mentions legales servent a l'en-tete des tickets.
 */
export function Configuration({
  chemin,
  surTermine,
}: {
  chemin: string;
  surTermine: () => void;
}) {
  const [urlServeur, setUrlServeur] = useState('http://192.168.1.10:3000/api/v1');
  const [codeMagasin, setCodeMagasin] = useState('SV');
  const [numeroCaisse, setNumeroCaisse] = useState('1');
  const [raisonSociale, setRaisonSociale] = useState('');
  const [adresse, setAdresse] = useState('');
  const [telephone, setTelephone] = useState('');
  const [rc, setRc] = useState('');
  const [nif, setNif] = useState('');
  const [nis, setNis] = useState('');
  const [articleImposition, setArticleImposition] = useState('');
  const [imprimante, setImprimante] = useState('');

  const [test, setTest] = useState<{ joignable: boolean; message?: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const api = () => (window as unknown as { caisse: ApiConfiguration }).caisse;

  const tester = async () => {
    setOccupe(true);
    setTest(null);
    try {
      setTest(await api().testerServeur(urlServeur));
    } catch (e) {
      setTest({ joignable: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setOccupe(false);
    }
  };

  const enregistrer = async () => {
    setErreur(null);
    setOccupe(true);
    try {
      await api().enregistrerConfiguration({
        urlServeur,
        codeMagasin,
        numeroCaisse: Number(numeroCaisse) || 1,
        raisonSociale,
        adresse, telephone, rc, nif, nis, articleImposition,
        imprimante,
      });
      surTermine();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  const complet =
    urlServeur.trim().length > 10 &&
    codeMagasin.trim().length > 0 &&
    Number(numeroCaisse) > 0 &&
    raisonSociale.trim().length > 1;

  const champ = (
    id: string,
    libelle: string,
    valeur: string,
    changer: (v: string) => void,
    options: { aide?: string; type?: string } = {},
  ) => (
    <div className="champ">
      <label htmlFor={id}>{libelle}</label>
      <input
        id={id}
        type={options.type ?? 'text'}
        value={valeur}
        onChange={(e) => changer(e.target.value)}
      />
      {options.aide && <div className="discret" style={{ marginTop: 4 }}>{options.aide}</div>}
    </div>
  );

  return (
    <div className="plein-ecran">
      <div className="bandeau">
        <span className="titre">GestGlobale — installation de la caisse</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <p className="discret">
            Ce poste n&apos;est pas encore configure. Renseignez l&apos;adresse du serveur et
            l&apos;identite de la caisse. La configuration sera ecrite dans
            <br />
            <code>{chemin}</code>
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div className="carte" style={{ width: '100%' }}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>Serveur et identite du poste</h2>

              {champ('url', 'Adresse du serveur central', urlServeur, setUrlServeur, {
                aide: 'Exemple : http://192.168.1.10:3000/api/v1',
              })}

              <div className="rangee" style={{ gap: 12 }}>
                <button onClick={() => void tester()} disabled={occupe}>
                  {occupe ? 'Test en cours...' : 'Tester la connexion'}
                </button>
                {test && (
                  <span className={`message ${test.joignable ? 'info' : 'erreur'}`}
                    style={{ margin: 0, padding: '8px 12px' }}>
                    {test.joignable ? 'Serveur joignable' : test.message}
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12,
                marginTop: 14 }}>
                {champ('magasin', 'Code du magasin', codeMagasin, setCodeMagasin, {
                  aide: 'Tel qu’il est declare au serveur',
                })}
                {champ('caisse', 'Numero de caisse', numeroCaisse, setNumeroCaisse, {
                  aide: 'Unique par magasin',
                })}
              </div>

              {champ('imprimante', 'Imprimante ticket (facultatif)', imprimante, setImprimante, {
                aide: 'Windows : \\\\\\\\.\\\\COM3 ou le nom du port. Laisser vide pour ne pas imprimer.',
              })}
            </div>

            <div className="carte" style={{ width: '100%' }}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>En-tete des tickets</h2>
              <p className="discret" style={{ marginTop: 0 }}>
                Ces mentions sont imprimees sur chaque ticket.
              </p>
              {champ('raison', 'Raison sociale', raisonSociale, setRaisonSociale)}
              {champ('adresse', 'Adresse', adresse, setAdresse)}
              {champ('telephone', 'Telephone', telephone, setTelephone)}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {champ('rc', 'RC', rc, setRc)}
                {champ('nif', 'NIF', nif, setNif)}
                {champ('nis', 'NIS', nis, setNis)}
                {champ('art', 'Article d’imposition', articleImposition, setArticleImposition)}
              </div>
            </div>
          </div>

          {erreur && <div className="message erreur">{erreur}</div>}

          <div className="rangee" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
            <button
              className="principal"
              style={{ minWidth: 280, minHeight: 56, fontSize: 18 }}
              disabled={!complet || occupe}
              onClick={() => void enregistrer()}
            >
              {occupe ? 'Enregistrement...' : 'Enregistrer et demarrer la caisse'}
            </button>
          </div>
          {!complet && (
            <p className="discret" style={{ textAlign: 'right' }}>
              Adresse du serveur, code magasin, numero de caisse et raison sociale sont requis.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
