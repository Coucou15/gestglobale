import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate, telecharger } from '../client';
import type { Utilisateur } from '../Application';

/**
 * Rapports du gerant (M9).
 *
 * Chaque rapport s'affiche a l'ecran et s'exporte en Excel ou en PDF.
 * Les trois vues sortent de la meme description cote serveur, donc ce
 * qui est a l'ecran est exactement ce qui part dans le fichier.
 */

interface Onglet {
  cle: string;
  libelle: string;
  /** Vrai si le rapport porte sur une periode plutot que sur un etat. */
  periodique: boolean;
  droit: string;
  aide: string;
}

const ONGLETS: Onglet[] = [
  {
    cle: 'periode', libelle: 'Synthese', periodique: true,
    droit: 'rapport.son_magasin',
    aide: 'Chiffre d’affaires, marge et panier moyen, par jour, heure, caisse, caissier et rayon.',
  },
  {
    cle: 'produits', libelle: 'Palmares', periodique: true,
    droit: 'rapport.son_magasin',
    aide: 'Meilleures ventes et produits les moins rentables.',
  },
  {
    cle: 'ventes-a-perte', libelle: 'Ventes a perte', periodique: true,
    droit: 'rapport.son_magasin',
    aide: 'Articles vendus sous leur CUMP. Une promotion d’appel y figure legitimement.',
  },
  {
    cle: 'ecarts-de-caisse', libelle: 'Ecarts de caisse', periodique: false,
    droit: 'rapport.son_magasin',
    aide: 'Clotures Z, ecarts par caissier et justifications.',
  },
  {
    cle: 'annulations-et-remises', libelle: 'Annulations et remises', periodique: true,
    droit: 'rapport.son_magasin',
    aide: 'Les deux gestes par lesquels de l’argent sort sans marchandise.',
  },
  {
    cle: 'ruptures', libelle: 'Ruptures', periodique: false,
    droit: 'rapport.stocks',
    aide: 'Articles epuises ou sous leur seuil de reassort.',
  },
  {
    cle: 'dormants', libelle: 'Dormants', periodique: false,
    droit: 'rapport.stocks',
    aide: 'Stock qui ne tourne plus : de l’argent immobilise en rayon.',
  },
  {
    cle: 'resumes', libelle: 'Resumes quotidiens', periodique: false,
    droit: 'rapport.son_magasin',
    aide: 'Le resume envoye au gerant chaque matin.',
  },
];

const DA = (v: unknown) => formaterDA(Number(v ?? 0));
const JOUR = (v: unknown) => (v ? formaterDate(v as string).slice(0, 10) : '—');
const QTE = (milli: unknown) => (Number(milli ?? 0) / 1000).toLocaleString('fr-FR');

function debutDuMois(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function Rapports({ utilisateur }: { utilisateur: Utilisateur }) {
  const visibles = ONGLETS.filter((o) => utilisateur.permissions.includes(o.droit));
  const [onglet, setOnglet] = useState(visibles[0]?.cle ?? 'periode');
  const [debut, setDebut] = useState(debutDuMois());
  const [fin, setFin] = useState(new Date().toISOString().slice(0, 10));
  const [sens, setSens] = useState<'TOP' | 'FLOP'>('TOP');
  const [jours, setJours] = useState('30');
  /**
   * Les donnees sont gardees avec l'onglet qui les a demandees.
   *
   * Sans ce lien, le rendu qui suit un changement d'onglet presentait
   * les donnees du rapport precedent au nouveau : les formes different
   * d'un rapport a l'autre, et toute la page partait en erreur.
   */
  const [resultat, setResultat] = useState<{ onglet: string; donnees: any } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const courant = ONGLETS.find((o) => o.cle === onglet)!;
  // On n'affiche que des donnees qui correspondent a l'onglet courant.
  const pret = resultat !== null && resultat.onglet === onglet && erreur === null;

  /** Parametres communs a l'affichage et a l'export : ils ne doivent pas diverger. */
  const parametres = (): string => {
    const p = new URLSearchParams();
    if (courant.periodique) {
      p.set('debut', new Date(`${debut}T00:00:00`).toISOString());
      // La borne de fin est exclusive cote serveur. L'utilisateur qui
      // choisit « au 21/11 » veut le 21 inclus : sans ce jour ajoute,
      // un rapport demande jusqu'a aujourd'hui affichait zero.
      const lendemain = new Date(`${fin}T00:00:00`);
      lendemain.setDate(lendemain.getDate() + 1);
      p.set('fin', lendemain.toISOString());
    }
    if (onglet === 'produits') p.set('sens', sens);
    if (onglet === 'ecarts-de-caisse' || onglet === 'dormants') p.set('jours', jours);
    return p.toString();
  };

  const charger = async () => {
    setErreur(null); setOccupe(true);
    const demande = onglet;
    try {
      const donnees = await appeler<any>(`/rapports/${demande}?${parametres()}`);
      setResultat({ onglet: demande, donnees });
    } catch (e) {
      setResultat(null);
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  useEffect(() => {
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet, debut, fin, sens, jours]);

  const exporter = async (format: 'xlsx' | 'pdf') => {
    setErreur(null); setInfo(null); setOccupe(true);
    try {
      const nom = await telecharger(`/rapports/${onglet}/export.${format}?${parametres()}`);
      setInfo(`${nom} telecharge.`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const produireResume = async () => {
    setErreur(null); setInfo(null); setOccupe(true);
    try {
      const veille = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const r = await appeler<any>('/rapports/resumes', {
        methode: 'POST', corps: { jour: veille },
      });
      setInfo(r.envoyeLe
        ? `Resume du ${JOUR(r.jour)} envoye a ${r.destinataires.join(', ')}.`
        : `Resume du ${JOUR(r.jour)} produit, non envoye : ${r.erreurEnvoi}`);
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  return (
    <>
      <div className="entete-page">
        <h1>Rapports</h1>
        <span className="espace" />
        {onglet !== 'resumes' && (
          <>
            <button disabled={occupe} onClick={() => void exporter('xlsx')}>Excel</button>
            <button disabled={occupe} onClick={() => void exporter('pdf')}>PDF</button>
          </>
        )}
      </div>

      <div className="barre-outils">
        {visibles.map((o) => (
          <button
            key={o.cle}
            className={o.cle === onglet ? 'principal' : ''}
            onClick={() => { setOnglet(o.cle); setInfo(null); }}
          >
            {o.libelle}
          </button>
        ))}
      </div>

      <p className="discret" style={{ marginTop: 0 }}>{courant.aide}</p>

      <div className="barre-outils">
        {courant.periodique && (
          <>
            <div className="champ" style={{ marginBottom: 0 }}>
              <label htmlFor="debut">Du</label>
              <input id="debut" type="date" value={debut}
                onChange={(e) => setDebut(e.target.value)} />
            </div>
            <div className="champ" style={{ marginBottom: 0 }}>
              <label htmlFor="fin">Au</label>
              <input id="fin" type="date" value={fin}
                onChange={(e) => setFin(e.target.value)} />
            </div>
          </>
        )}
        {onglet === 'produits' && (
          <div className="champ" style={{ marginBottom: 0 }}>
            <label htmlFor="sens">Classement</label>
            <select id="sens" value={sens}
              onChange={(e) => setSens(e.target.value as 'TOP' | 'FLOP')}>
              <option value="TOP">Meilleures ventes</option>
              <option value="FLOP">Les moins rentables</option>
            </select>
          </div>
        )}
        {(onglet === 'ecarts-de-caisse' || onglet === 'dormants') && (
          <div className="champ" style={{ marginBottom: 0 }}>
            <label htmlFor="jours">Sur</label>
            <select id="jours" value={jours} onChange={(e) => setJours(e.target.value)}>
              <option value="7">7 jours</option>
              <option value="30">30 jours</option>
              <option value="90">90 jours</option>
              <option value="365">1 an</option>
            </select>
          </div>
        )}
        {onglet === 'resumes' && (
          <button className="principal" disabled={occupe} onClick={() => void produireResume()}>
            Produire le resume d’hier
          </button>
        )}
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}
      {info && <div className="message info">{info}</div>}

      {!pret && <p className="discret">Chargement...</p>}
      {pret && <Contenu onglet={onglet} donnees={resultat!.donnees} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function Chiffres({ cases }: { cases: Array<{ intitule: string; valeur: string }> }) {
  return (
    <div className="cartes">
      {cases.map((c) => (
        <div className="carte" key={c.intitule}>
          <div className="intitule">{c.intitule}</div>
          <div className="valeur">{c.valeur}</div>
        </div>
      ))}
    </div>
  );
}

function Tableau({
  titre, colonnes, lignes, vide,
}: {
  titre?: string;
  colonnes: Array<{ titre: string; rendu: (l: any) => any; nombre?: boolean }>;
  lignes: any[];
  vide?: string;
}) {
  // Un rapport mal forme ne doit pas emporter l'ecran entier : React
  // demonte tout l'arbre sur une exception de rendu, et le gerant se
  // retrouve devant une page blanche jusqu'au rechargement.
  const rangees = Array.isArray(lignes) ? lignes : [];
  return (
    <>
      {titre && <h2 style={{ fontSize: 17, marginBottom: 8 }}>{titre}</h2>}
      <div className="tableau" style={{ marginBottom: 20 }}>
        <table>
          <thead>
            <tr>
              {colonnes.map((c) => (
                <th key={c.titre} className={c.nombre ? 'nombre' : ''}>{c.titre}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rangees.map((l, i) => (
              <tr key={i}>
                {colonnes.map((c) => (
                  <td key={c.titre} className={c.nombre ? 'nombre' : ''}>{c.rendu(l)}</td>
                ))}
              </tr>
            ))}
            {rangees.length === 0 && (
              <tr>
                <td colSpan={colonnes.length} className="discret centre" style={{ padding: 20 }}>
                  {vide ?? 'Aucune donnee sur cette periode.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Contenu({ onglet, donnees }: { onglet: string; donnees: any }) {
  switch (onglet) {
    case 'periode': {
      const tauxMarge = donnees.chiffreAffairesHtCentimes > 0
        ? (donnees.margeCentimes / donnees.chiffreAffairesHtCentimes) * 100
        : 0;
      return (
        <>
          <Chiffres cases={[
            { intitule: 'Chiffre d’affaires TTC', valeur: DA(donnees.chiffreAffairesTtcCentimes) },
            {
              intitule: 'Marge',
              valeur: `${DA(donnees.margeCentimes)} (${tauxMarge.toFixed(1).replace('.', ',')} %)`,
            },
            { intitule: 'Tickets', valeur: String(donnees.nombreTickets) },
            { intitule: 'Panier moyen', valeur: DA(donnees.panierMoyenCentimes) },
          ]} />
          <Tableau titre="Par jour" lignes={donnees.parJour} colonnes={[
            { titre: 'Jour', rendu: (l) => JOUR(l.jour) },
            { titre: 'Tickets', rendu: (l) => l.nombreTickets, nombre: true },
            { titre: 'CA TTC', rendu: (l) => DA(l.chiffreAffairesCentimes), nombre: true },
          ]} />
          <Tableau titre="Par heure" lignes={donnees.parHeure} colonnes={[
            { titre: 'Heure', rendu: (l) => `${l.heure}h` },
            { titre: 'Tickets', rendu: (l) => l.nombreTickets, nombre: true },
            { titre: 'CA TTC', rendu: (l) => DA(l.chiffreAffairesCentimes), nombre: true },
            { titre: 'Marge', rendu: (l) => DA(l.margeCentimes), nombre: true },
          ]} />
          <Tableau titre="Par caisse" lignes={donnees.parCaisse} colonnes={[
            { titre: 'Caisse', rendu: (l) => l.numeroCaisse ?? '—' },
            { titre: 'Tickets', rendu: (l) => l.nombreTickets, nombre: true },
            { titre: 'CA TTC', rendu: (l) => DA(l.chiffreAffairesCentimes), nombre: true },
            { titre: 'Marge', rendu: (l) => DA(l.margeCentimes), nombre: true },
          ]} />
          <Tableau titre="Par caissier" lignes={donnees.parCaissier} colonnes={[
            { titre: 'Code', rendu: (l) => l.code },
            { titre: 'Caissier', rendu: (l) => l.nom },
            { titre: 'Tickets', rendu: (l) => l.nombreTickets, nombre: true },
            { titre: 'CA TTC', rendu: (l) => DA(l.chiffreAffairesCentimes), nombre: true },
          ]} />
          <Tableau titre="Par rayon et famille" lignes={donnees.parFamille} colonnes={[
            { titre: 'Rayon', rendu: (l) => l.rayon ?? '—' },
            { titre: 'Famille', rendu: (l) => l.famille ?? '—' },
            { titre: 'Quantite', rendu: (l) => QTE(l.quantiteMilli), nombre: true },
            { titre: 'CA TTC', rendu: (l) => DA(l.chiffreAffairesCentimes), nombre: true },
            { titre: 'Marge', rendu: (l) => DA(l.margeCentimes), nombre: true },
          ]} />
          <Tableau titre="Par mode de reglement" lignes={donnees.parModePaiement} colonnes={[
            { titre: 'Mode', rendu: (l) => l.mode },
            { titre: 'Montant', rendu: (l) => DA(l.montantCentimes), nombre: true },
          ]} />
        </>
      );
    }

    case 'produits':
      return (
        <Tableau lignes={donnees} colonnes={[
          { titre: 'Reference', rendu: (l) => l.reference },
          { titre: 'Designation', rendu: (l) => l.designation },
          { titre: 'Quantite', rendu: (l) => QTE(l.quantiteMilli), nombre: true },
          { titre: 'CA TTC', rendu: (l) => DA(l.chiffreAffairesCentimes), nombre: true },
          {
            titre: 'Marge',
            rendu: (l) => (
              <span className={l.venteAPerte ? 'etiquette rouge' : ''}>
                {DA(l.margeCentimes)}
              </span>
            ),
            nombre: true,
          },
        ]} />
      );

    case 'ventes-a-perte':
      return (
        <>
          <Chiffres cases={[
            { intitule: 'Lignes concernees', valeur: String(donnees.nombreLignes) },
            { intitule: 'Perte cumulee', valeur: DA(donnees.perteTotaleCentimes) },
            { intitule: 'References', valeur: String(donnees.articles.length) },
          ]} />
          <Tableau lignes={donnees.articles} vide="Aucun produit vendu sous son CUMP." colonnes={[
            { titre: 'Reference', rendu: (l) => l.reference },
            { titre: 'Designation', rendu: (l) => l.designation },
            { titre: 'Quantite', rendu: (l) => QTE(l.quantiteMilli), nombre: true },
            { titre: 'Prix moyen', rendu: (l) => DA(l.prixMoyenCentimes), nombre: true },
            { titre: 'CUMP moyen', rendu: (l) => DA(l.cumpMoyenCentimes), nombre: true },
            { titre: 'Perte', rendu: (l) => DA(l.perteCentimes), nombre: true },
            {
              titre: 'Dont promo',
              rendu: (l) => (l.lignesEnPromotion > 0
                ? <span className="etiquette neutre">{l.lignesEnPromotion}</span>
                : '—'),
              nombre: true,
            },
          ]} />
        </>
      );

    case 'ecarts-de-caisse': {
      const cumul = donnees.parCaissier.reduce(
        (t: number, p: any) => t + Number(p.ecartCumuleCentimes), 0,
      );
      const nonJustifies = donnees.parCaissier.reduce(
        (t: number, p: any) => t + Number(p.nombreNonJustifies), 0,
      );
      return (
        <>
          <Chiffres cases={[
            { intitule: 'Ecart cumule', valeur: DA(cumul) },
            { intitule: 'Clotures', valeur: String(donnees.clotures.length) },
            { intitule: 'Ecarts non justifies', valeur: String(nonJustifies) },
          ]} />
          <Tableau titre="Par caissier" lignes={donnees.parCaissier}
            vide="Aucune cloture Z sur la periode." colonnes={[
              { titre: 'Code', rendu: (l) => l.code },
              { titre: 'Caissier', rendu: (l) => l.nom },
              { titre: 'Clotures', rendu: (l) => l.nombreClotures, nombre: true },
              { titre: 'Ecart cumule', rendu: (l) => DA(l.ecartCumuleCentimes), nombre: true },
              { titre: 'Ecart absolu', rendu: (l) => DA(l.ecartAbsoluCentimes), nombre: true },
              { titre: 'Manquants', rendu: (l) => l.nombreManquants, nombre: true },
              { titre: 'Excedents', rendu: (l) => l.nombreExcedents, nombre: true },
              {
                titre: 'Non justifies',
                rendu: (l) => (l.nombreNonJustifies > 0
                  ? <span className="etiquette orange">{l.nombreNonJustifies}</span>
                  : '—'),
                nombre: true,
              },
            ]} />
          <Tableau titre="Detail des clotures" lignes={donnees.clotures} colonnes={[
            { titre: 'Cloture', rendu: (l) => l.numero },
            { titre: 'Date', rendu: (l) => formaterDate(l.clotureeLe) },
            { titre: 'Caisse', rendu: (l) => l.numeroCaisse },
            { titre: 'Caissier', rendu: (l) => l.caissierNom },
            { titre: 'Theorique', rendu: (l) => DA(l.theoriqueEspecesCentimes), nombre: true },
            { titre: 'Compte', rendu: (l) => DA(l.compteEspecesCentimes), nombre: true },
            { titre: 'Ecart', rendu: (l) => DA(l.ecartCentimes), nombre: true },
            { titre: 'Justification', rendu: (l) => l.justification ?? '—' },
          ]} />
          <p className="discret">
            Un ecart n’accuse personne : un total de ticket tombe sur n’importe quel centime
            alors que la plus petite coupure vaut 5 DA, donc une part de l’ecart est
            structurelle. Ce qui se lit ici, c’est la derive et les ecarts restes sans
            explication.
          </p>
        </>
      );
    }

    case 'annulations-et-remises':
      return (
        <>
          <Tableau titre="Remises par caissier" lignes={donnees.remisesParCaissier}
            vide="Aucune remise accordee." colonnes={[
              { titre: 'Code', rendu: (l) => l.code },
              { titre: 'Caissier', rendu: (l) => l.nom },
              { titre: 'Remises', rendu: (l) => l.nombreRemises, nombre: true },
              { titre: 'Total accorde', rendu: (l) => DA(l.totalRemiseCentimes), nombre: true },
              {
                titre: 'Dont forcees',
                rendu: (l) => (l.nombreForcees > 0
                  ? <span className="etiquette orange">{l.nombreForcees}</span>
                  : '—'),
                nombre: true,
              },
            ]} />
          <Tableau titre="Tickets annules" lignes={donnees.annulations}
            vide="Aucun ticket annule." colonnes={[
              { titre: 'Ticket', rendu: (l) => l.numero },
              { titre: 'Date', rendu: (l) => formaterDate(l.dateVente) },
              { titre: 'Caisse', rendu: (l) => l.numeroCaisse ?? '—' },
              { titre: 'Caissier', rendu: (l) => l.caissierNom },
              { titre: 'Lignes', rendu: (l) => l.nombreLignes, nombre: true },
              { titre: 'Montant', rendu: (l) => DA(l.totalTtcCentimes), nombre: true },
            ]} />
          <Tableau titre="Remises ligne par ligne" lignes={donnees.remises} colonnes={[
            { titre: 'Ticket', rendu: (l) => l.numero },
            { titre: 'Caissier', rendu: (l) => l.caissierNom },
            { titre: 'Article', rendu: (l) => l.designation },
            { titre: 'Prix', rendu: (l) => DA(l.prixUnitaireCentimes), nombre: true },
            { titre: 'Taux', rendu: (l) => `${l.remisePourcent} %`, nombre: true },
            { titre: 'Remise', rendu: (l) => DA(l.remiseCentimes), nombre: true },
            { titre: 'Autorisee par', rendu: (l) => l.autoriseeParNom ?? '—' },
          ]} />
        </>
      );

    case 'ruptures': {
      const enRupture = donnees.filter((r: any) => r.rupture).length;
      return (
        <>
          <Chiffres cases={[
            { intitule: 'En rupture', valeur: String(enRupture) },
            { intitule: 'Sous le seuil', valeur: String(donnees.length - enRupture) },
          ]} />
          <Tableau lignes={donnees} vide="Aucune rupture ni franchissement de seuil." colonnes={[
            { titre: 'Reference', rendu: (l) => l.reference },
            { titre: 'Designation', rendu: (l) => l.designation },
            { titre: 'Lieu', rendu: (l) => l.emplacement },
            { titre: 'Stock', rendu: (l) => QTE(l.stockMilli), nombre: true },
            { titre: 'Seuil', rendu: (l) => QTE(l.seuilAlerteMilli), nombre: true },
            {
              titre: 'Etat',
              rendu: (l) => (
                <span className={`etiquette ${l.rupture ? 'rouge' : 'orange'}`}>
                  {l.rupture ? 'rupture' : 'sous le seuil'}
                </span>
              ),
            },
            { titre: 'Vendu 30 j', rendu: (l) => QTE(l.quantiteVendue30jMilli), nombre: true },
            { titre: 'Derniere sortie', rendu: (l) => JOUR(l.derniereSortie) },
          ]} />
        </>
      );
    }

    case 'dormants': {
      const valeur = donnees.reduce(
        (t: number, l: any) => t + Number(l.valeurImmobiliseeCentimes), 0,
      );
      return (
        <>
          <Chiffres cases={[
            { intitule: 'References concernees', valeur: String(donnees.length) },
            { intitule: 'Argent immobilise', valeur: DA(valeur) },
          ]} />
          <Tableau lignes={donnees} vide="Tout le stock a tourne sur la periode." colonnes={[
            { titre: 'Reference', rendu: (l) => l.reference },
            { titre: 'Designation', rendu: (l) => l.designation },
            { titre: 'Stock', rendu: (l) => QTE(l.stockMilli), nombre: true },
            {
              titre: 'Valeur au CUMP',
              rendu: (l) => DA(l.valeurImmobiliseeCentimes), nombre: true,
            },
          ]} />
        </>
      );
    }

    case 'resumes':
      return (
        <>
          {donnees.length === 0 && (
            <p className="discret">
              Aucun resume produit pour l’instant. Il part automatiquement chaque matin
              une fois le relais de messagerie configure ; le bouton ci-dessus permet de
              le produire tout de suite.
            </p>
          )}
          {donnees.map((r: any) => (
            <div className="carte" key={r.id} style={{ marginBottom: 16 }}>
              <div className="entete-page" style={{ marginBottom: 8 }}>
                <strong>{JOUR(r.jour)}</strong>
                <span className="espace" />
                {r.envoyeLe
                  ? <span className="etiquette vert">envoye</span>
                  : <span className="etiquette orange">non envoye</span>}
              </div>
              {r.erreurEnvoi && <div className="discret">{r.erreurEnvoi}</div>}
              {r.destinataires?.length > 0 && (
                <div className="discret">Destinataires : {r.destinataires.join(', ')}</div>
              )}
              <pre style={{
                whiteSpace: 'pre-wrap', fontFamily: 'monospace',
                fontSize: 13, marginBottom: 0,
              }}>{r.texte}</pre>
            </div>
          ))}
        </>
      );

    default:
      return null;
  }
}
