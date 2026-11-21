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
  const [reglements, setReglements] = useState<Array<{ mode: Mode; montantCentimes: number }>>([]);
  const [saisie, setSaisie] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [rechercheClient, setRechercheClient] = useState('');
  const [clients, setClients] = useState<ClientCaisse[]>([]);
  const [enCours, setEnCours] = useState(false);

  const encaisse = reglements.reduce((t, r) => t + r.montantCentimes, 0);
  const reste = Math.max(0, totalCentimes - encaisse);
  const rendu = Math.max(0, encaisse - totalCentimes);

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
              onClick={() => void ajouterReglement(mode, montantSaisi())}
            >
              {LIBELLES[mode]}
            </button>
          ))}
        </div>

        {reglements.length > 0 && (
          <table style={{ marginTop: 16 }}>
            <tbody>
              {reglements.map((r, i) => (
                <tr key={i}>
                  <td>{LIBELLES[r.mode]}</td>
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
