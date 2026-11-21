import { useEffect, useState } from 'react';
import { caisse, type ArticleCaisse, type ClientCaisse } from './api';

type Mode = 'ESPECES' | 'CARTE' | 'CHEQUE' | 'CREDIT' | 'BON_ACHAT';

interface LigneAffichee {
  numeroLigne: number;
  article: ArticleCaisse;
  codeScanne: string | null;
  quantiteMilli: number;
  prixCatalogueCentimes: number;
  prixUnitaireCentimes: number;
  remisePourcent: number;
  remiseCentimes: number;
  annulee: boolean;
  autoriseeParId: string | null;
  promotionId: string | null;
  avantages: Array<{ promotionId: string; libelle: string; remiseCentimes: number }>;
}

const COUPURES = [200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500];

function formater(centimes: number): string {
  return (centimes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 });
}

const LIBELLES: Record<Mode, string> = {
  ESPECES: 'Especes',
  CARTE: 'Carte (TPE)',
  CHEQUE: 'Cheque',
  CREDIT: 'A credit',
  BON_ACHAT: "Bon d'achat",
};

/** Encaissement : paiement simple ou mixte, avec rendu de monnaie (M4). */
export function Paiement({
  lignes,
  totalCentimes,
  client,
  plafondRemise,
  permissions,
  surClient,
  surAnnuler,
  surEncaisse,
}: {
  lignes: LigneAffichee[];
  totalCentimes: number;
  client: ClientCaisse | null;
  plafondRemise: number;
  permissions: string[];
  surClient: (c: ClientCaisse | null) => void;
  surAnnuler: () => void;
  surEncaisse: (numero: string) => void;
}) {
  const [reglements, setReglements] = useState<
    Array<{ mode: Mode; montantCentimes: number; reference?: string }>
  >([]);
  // Saisie du code quand le client presente un bon ou une carte cadeau.
  const [codeBon, setCodeBon] = useState<string | null>(null);
  const [points, setPoints] = useState<{
    points: number; valeurCentimes: number;
    bareme: { minimumUtilisation: number; valeurPointCentimes: number };
  } | null>(null);
  const [saisie, setSaisie] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [rechercheClient, setRechercheClient] = useState('');
  const [clients, setClients] = useState<ClientCaisse[]>([]);
  const [enCours, setEnCours] = useState(false);

  const encaisse = reglements.reduce((t, r) => t + r.montantCentimes, 0);
  const reste = Math.max(0, totalCentimes - encaisse);
  const rendu = Math.max(0, encaisse - totalCentimes);

  useEffect(() => {
    if (!client) { setPoints(null); return; }
    let vivant = true;
    void caisse().pointsClient(client.id).then((p) => { if (vivant) setPoints(p); });
    return () => { vivant = false; };
  }, [client]);

  useEffect(() => {
    if (rechercheClient.length < 2) { setClients([]); return; }
    let vivant = true;
    void caisse().chercherClient(rechercheClient).then((c) => { if (vivant) setClients(c); });
    return () => { vivant = false; };
  }, [rechercheClient]);

  const ajouterReglement = async (mode: Mode, montant: number) => {
    setErreur(null);
    if (montant <= 0) return;

    if (mode === 'CREDIT') {
      if (!client) { setErreur('Selectionnez un client pour une vente a credit'); return; }
      if (!permissions.includes('vente.a_credit')) {
        setErreur('Vous n’avez pas le droit de vendre a credit');
        return;
      }
      const decision = await caisse().controlerCredit(client.id, montant);
      if (!decision.autorise) {
        setErreur(
          decision.message +
            (decision.forcagePossible ? ' — un responsable peut autoriser cette vente' : ''),
        );
        return;
      }
    }
    setReglements((r) => [...r, { mode, montantCentimes: montant }]);
    setSaisie('');
  };

  /**
   * Le client presente un bon : la caisse l'evalue sur le solde qu'elle
   * connait. Hors ligne ce solde peut etre perime ; le serveur signalera
   * tout depassement a la remontee plutot que de refuser la vente.
   */
  const accepterBon = async (code: string) => {
    setErreur(null);
    const demande = Math.min(montantSaisi(), reste);
    if (demande <= 0) { setCodeBon(null); return; }

    const decision = await caisse().presenterBon(code, demande);
    if (!decision.accepte) {
      setErreur(
        (decision.message ?? 'Bon refuse')
          + (decision.motif === 'INCONNU'
            ? ' — s’il vient d’etre emis, synchronisez la caisse'
            : ''),
      );
      return;
    }

    setReglements((r) => [
      ...r,
      {
        mode: 'BON_ACHAT',
        montantCentimes: decision.montantUtiliseCentimes,
        reference: decision.code,
      },
    ]);
    setCodeBon(null);
    setSaisie('');
    if (decision.resteAPayerCentimes > 0) {
      setErreur(
        `Le bon couvre ${formater(decision.montantUtiliseCentimes)} DA — `
          + `reste ${formater(decision.resteAPayerCentimes)} DA a regler`,
      );
    }
  };

  const montantSaisi = (): number => {
    const brut = saisie.replace(',', '.').trim();
    if (!brut) return reste;
    const valeur = Number(brut);
    return Number.isFinite(valeur) ? Math.round(valeur * 100) : 0;
  };

  const valider = async () => {
    setErreur(null);
    setEnCours(true);
    try {
      const panier = {
        lignes: lignes.map((l) => ({
          numeroLigne: l.numeroLigne,
          article: l.article,
          codeScanne: l.codeScanne,
          quantiteMilli: l.quantiteMilli,
          prixUnitaireCentimes: l.prixUnitaireCentimes,
          remisePourcent: l.remisePourcent,
          remiseCentimes: l.remiseCentimes,
          annulee: l.annulee,
          autoriseeParId: l.autoriseeParId,
          promotionId: l.promotionId,
        })),
        clientId: client?.id ?? null,
        categoriePrix: client?.categoriePrix ?? 'DETAIL',
        remisePiedPourcent: 0,
      };
      const resultat = await caisse().encaisser(panier, reglements);
      void caisse().imprimer(resultat.ticket.numero);
      surEncaisse(resultat.ticket.numero);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  };

  void plafondRemise;

  return (
    <div className="voile">
      <div className="modale">
        <h2>Encaissement</h2>

        <div className="ligne-total grand">
          <span>Total</span>
          <span>{formater(totalCentimes)} DA</span>
        </div>
        <div className="ligne-total">
          <span>Deja regle</span>
          <span>{formater(encaisse)} DA</span>
        </div>
        <div className="ligne-total" style={{ color: reste > 0 ? 'var(--orange)' : 'var(--vert)' }}>
          <span>{reste > 0 ? 'Reste a payer' : 'Rendu de monnaie'}</span>
          <span>{formater(reste > 0 ? reste : rendu)} DA</span>
        </div>

        <div className="champ" style={{ marginTop: 16 }}>
          <label htmlFor="montant">Montant remis (vide = solde restant)</label>
          <input
            id="montant"
            autoFocus
            inputMode="decimal"
            value={saisie}
            placeholder={formater(reste)}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void ajouterReglement('ESPECES', montantSaisi())}
          />
        </div>

        <div className="grille-touches" style={{ padding: 0, marginBottom: 12 }}>
          {COUPURES.slice(0, 6).map((c) => (
            <button key={c} onClick={() => setSaisie(String(c / 100))}>
              {formater(c)}
            </button>
          ))}
        </div>

        <div className="grille-touches" style={{ padding: 0 }}>
          {(Object.keys(LIBELLES) as Mode[]).map((mode) => (
            <button
              key={mode}
              className={mode === 'ESPECES' ? 'principal' : ''}
              onClick={() => {
                if (mode === 'BON_ACHAT') { setErreur(null); setCodeBon(''); return; }
                void ajouterReglement(mode, montantSaisi());
              }}
            >
              {LIBELLES[mode]}
            </button>
          ))}
        </div>

        {codeBon !== null && (
          <div className="champ" style={{ marginTop: 16 }}>
            <label htmlFor="code-bon">Code du bon ou de la carte cadeau</label>
            <input
              id="code-bon"
              autoFocus
              value={codeBon}
              placeholder={`CAD-${new Date().getFullYear()}-000001`}
              onChange={(e) => setCodeBon(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && codeBon.trim()) void accepterBon(codeBon);
                if (e.key === 'Escape') setCodeBon(null);
              }}
            />
            <div className="rangee" style={{ marginTop: 8 }}>
              <button style={{ flex: 1 }} onClick={() => setCodeBon(null)}>Annuler</button>
              <button
                className="principal"
                style={{ flex: 1 }}
                disabled={!codeBon.trim()}
                onClick={() => void accepterBon(codeBon)}
              >
                Valider le bon
              </button>
            </div>
          </div>
        )}

        {reglements.length > 0 && (
          <table style={{ marginTop: 16 }}>
            <tbody>
              {reglements.map((r, i) => (
                <tr key={i}>
                  <td>
                    {LIBELLES[r.mode]}
                    {r.reference && <span className="discret"> {r.reference}</span>}
                  </td>
                  <td className="nombre">{formater(r.montantCentimes)} DA</td>
                  <td style={{ width: 60 }}>
                    <button onClick={() => setReglements((l) => l.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="champ" style={{ marginTop: 16 }}>
          <label htmlFor="client">Client (carte fidelite, nom ou code)</label>
          <input
            id="client"
            value={client ? client.nom : rechercheClient}
            onChange={(e) => { surClient(null); setRechercheClient(e.target.value); }}
          />
          {clients.length > 0 && !client && (
            <div className="lignes" style={{ maxHeight: 160, marginTop: 8 }}>
              <table>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.id} onClick={() => { surClient(c); setRechercheClient(''); setClients([]); }}>
                      <td>{c.nom}</td>
                      <td className="nombre discret">
                        solde {formater(c.soldeCentimes)} DA
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {client && points && points.points > 0 && (
          <p className="discret" style={{ marginTop: 0 }}>
            {points.points} point{points.points > 1 ? 's' : ''} de fidelite —{' '}
            {formater(points.valeurCentimes)} DA
            {points.points < points.bareme.minimumUtilisation
              ? ` (il en faut ${points.bareme.minimumUtilisation} pour un bon)`
              : ' — echangeables contre un bon au comptoir'}
          </p>
        )}

        {erreur && <div className="message erreur">{erreur}</div>}

        <div className="rangee" style={{ marginTop: 16 }}>
          <button style={{ flex: 1 }} onClick={surAnnuler}>Retour</button>
          <button
            className="valide"
            style={{ flex: 2 }}
            disabled={reste > 0 || enCours}
            onClick={() => void valider()}
          >
            {enCours ? 'Enregistrement...' : 'Valider et imprimer'}
          </button>
        </div>
      </div>
    </div>
  );
}
