import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate, telecharger } from '../client';
import type { Utilisateur } from '../Application';

/**
 * Journaux comptables et etats de declaration (M12).
 *
 * Quatre vues : les journaux des ventes, des achats et de tresorerie,
 * puis l'etat pour les declarations. Chacune s'exporte en CSV pour le
 * logiciel du comptable, en Excel pour le travail a la main, en PDF
 * pour l'archive.
 */

interface Onglet {
  cle: string;
  libelle: string;
  aide: string;
}

const ONGLETS: Onglet[] = [
  {
    cle: 'journal-ventes', libelle: 'Ventes',
    aide: 'Une ligne par piece, avec sa ventilation de TVA et son reglement.',
  },
  {
    cle: 'journal-achats', libelle: 'Achats',
    aide: 'Factures fournisseurs, TVA deductible et reste du.',
  },
  {
    cle: 'journal-tresorerie', libelle: 'Tresorerie',
    aide: 'Toutes les entrees et sorties, par compte et par categorie.',
  },
  {
    cle: 'declaration', libelle: 'Declarations',
    aide: 'Chiffre d’affaires et TVA par taux, droit de timbre.',
  },
];

const DA = (v: unknown) => formaterDA(Number(v ?? 0));
const JOUR = (v: unknown) => (v ? formaterDate(v as string).slice(0, 10) : '—');

/** Le mois precedent : un comptable travaille sur un mois clos. */
function moisPrecedent(): { debut: string; fin: string } {
  const d = new Date();
  const debut = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const fin = new Date(d.getFullYear(), d.getMonth(), 0);
  return {
    debut: debut.toISOString().slice(0, 10),
    fin: fin.toISOString().slice(0, 10),
  };
}

export function Comptabilite({ utilisateur }: { utilisateur: Utilisateur }) {
  void utilisateur;
  const defaut = moisPrecedent();

  const [onglet, setOnglet] = useState('journal-ventes');
  const [debut, setDebut] = useState(defaut.debut);
  const [fin, setFin] = useState(defaut.fin);
  const [separateur, setSeparateur] = useState('point-virgule');
  const [resultat, setResultat] = useState<{ onglet: string; donnees: any } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const courant = ONGLETS.find((o) => o.cle === onglet)!;
  const pret = resultat !== null && resultat.onglet === onglet && erreur === null;

  const parametres = (): string => {
    const p = new URLSearchParams();
    p.set('debut', new Date(`${debut}T00:00:00`).toISOString());
    // Borne de fin exclusive cote serveur : le dernier jour choisi doit
    // etre inclus.
    const lendemain = new Date(`${fin}T00:00:00`);
    lendemain.setDate(lendemain.getDate() + 1);
    p.set('fin', lendemain.toISOString());
    return p.toString();
  };

  const charger = async () => {
    setErreur(null);
    // Pendant qu'on change les dates, l'une peut passer devant l'autre
    // un instant. Interroger le serveur avec une periode impossible lui
    // fait rendre une erreur que l'utilisateur voit clignoter sans
    // comprendre : on la dit nous-memes, et on n'appelle pas.
    if (debut > fin) {
      setErreur('La date de debut doit preceder la date de fin.');
      setResultat(null);
      return;
    }
    setOccupe(true);
    const demande = onglet;
    try {
      const donnees = await appeler<any>(`/comptabilite/${demande}?${parametres()}`);
      setResultat({ onglet: demande, donnees });
    } catch (e) {
      setResultat(null);
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  useEffect(() => {
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet, debut, fin]);

  const exporter = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setErreur(null); setInfo(null); setOccupe(true);
    try {
      const options = format === 'csv' ? `&separateur=${separateur}` : '';
      const nom = await telecharger(
        `/comptabilite/${onglet}/export.${format}?${parametres()}${options}`,
      );
      setInfo(`${nom} telecharge.`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  return (
    <>
      <div className="entete-page">
        <h1>Comptabilite</h1>
        <span className="espace" />
        <button disabled={occupe} onClick={() => void exporter('csv')}>CSV</button>
        <button disabled={occupe} onClick={() => void exporter('xlsx')}>Excel</button>
        <button disabled={occupe} onClick={() => void exporter('pdf')}>PDF</button>
      </div>

      <div className="barre-outils">
        {ONGLETS.map((o) => (
          <button key={o.cle} className={o.cle === onglet ? 'principal' : ''}
            onClick={() => { setOnglet(o.cle); setInfo(null); }}>
            {o.libelle}
          </button>
        ))}
      </div>

      <p className="discret" style={{ marginTop: 0 }}>{courant.aide}</p>

      <div className="barre-outils">
        <div className="champ" style={{ marginBottom: 0 }}>
          <label htmlFor="debut">Du</label>
          <input id="debut" type="date" value={debut}
            onChange={(e) => setDebut(e.target.value)} />
        </div>
        <div className="champ" style={{ marginBottom: 0 }}>
          <label htmlFor="fin">Au</label>
          <input id="fin" type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
        </div>
        <div className="champ" style={{ marginBottom: 0 }}>
          <label htmlFor="separateur">Separateur du CSV</label>
          <select id="separateur" value={separateur}
            onChange={(e) => setSeparateur(e.target.value)}>
            <option value="point-virgule">Point-virgule (Excel francais)</option>
            <option value="virgule">Virgule</option>
            <option value="tabulation">Tabulation</option>
          </select>
        </div>
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
                  {vide ?? 'Aucune ecriture sur cette periode.'}
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
    case 'journal-ventes': {
      const taux: number[] = [...new Set<number>(
        donnees.lignes.flatMap((l: any) => l.ventilation.map((v: any) => v.taux)),
      )].sort((a, b) => a - b);
      return (
        <>
          <Chiffres cases={[
            { intitule: 'Pieces', valeur: String(donnees.totaux.nombrePieces) },
            { intitule: 'Total HT', valeur: DA(donnees.totaux.totalHtCentimes) },
            { intitule: 'TVA', valeur: DA(donnees.totaux.totalTvaCentimes) },
            { intitule: 'Total TTC', valeur: DA(donnees.totaux.totalTtcCentimes) },
          ]} />
          <Tableau lignes={donnees.lignes} vide="Aucune vente sur la periode." colonnes={[
            { titre: 'Date', rendu: (l) => JOUR(l.date) },
            { titre: 'Mag.', rendu: (l) => l.magasin },
            { titre: 'Piece', rendu: (l) => l.numero },
            { titre: 'Type', rendu: (l) => l.type },
            { titre: 'Client', rendu: (l) => l.clientNom ?? '—' },
            ...taux.flatMap((t) => ([
              {
                titre: `Base ${t} %`,
                rendu: (l: any) => DA(
                  l.ventilation.find((v: any) => v.taux === t)?.htCentimes ?? 0,
                ),
                nombre: true,
              },
              {
                titre: `TVA ${t} %`,
                rendu: (l: any) => DA(
                  l.ventilation.find((v: any) => v.taux === t)?.tvaCentimes ?? 0,
                ),
                nombre: true,
              },
            ])),
            { titre: 'Timbre', rendu: (l) => DA(l.timbreCentimes), nombre: true },
            { titre: 'Total TTC', rendu: (l) => DA(l.totalTtcCentimes), nombre: true },
            { titre: 'Reglement', rendu: (l) => l.reglements || '—' },
            {
              titre: 'Statut',
              rendu: (l) => (l.statut === 'ANNULE'
                ? <span className="etiquette rouge">annule</span>
                : <span className="etiquette vert">valide</span>),
            },
          ]} />
          {donnees.nombreAnnulations > 0 && (
            <p className="discret">
              {donnees.nombreAnnulations} piece(s) annulee(s) figurent au journal avec leur
              statut et ne sont pas comptees dans les totaux. Les y laisser est voulu :
              effacer une piece annulee laisserait un trou dans la numerotation que personne
              ne pourrait expliquer.
            </p>
          )}
        </>
      );
    }

    case 'journal-achats':
      return (
        <>
          <Chiffres cases={[
            { intitule: 'Factures', valeur: String(donnees.totaux.nombrePieces) },
            { intitule: 'Total HT', valeur: DA(donnees.totaux.totalHtCentimes) },
            { intitule: 'TVA deductible', valeur: DA(donnees.totaux.totalTvaCentimes) },
            { intitule: 'Reste du', valeur: DA(donnees.totaux.resteDuCentimes) },
          ]} />
          <Tableau lignes={donnees.lignes}
            vide="Aucune facture fournisseur sur la periode." colonnes={[
              { titre: 'Date', rendu: (l) => JOUR(l.date) },
              { titre: 'Mag.', rendu: (l) => l.magasin },
              { titre: 'Piece', rendu: (l) => l.numero },
              { titre: 'N° fournisseur', rendu: (l) => l.numeroFournisseur ?? '—' },
              { titre: 'Fournisseur', rendu: (l) => l.fournisseurNom },
              { titre: 'NIF', rendu: (l) => l.fournisseurNif ?? '—' },
              { titre: 'Total HT', rendu: (l) => DA(l.totalHtCentimes), nombre: true },
              { titre: 'TVA', rendu: (l) => DA(l.totalTvaCentimes), nombre: true },
              { titre: 'Total TTC', rendu: (l) => DA(l.totalTtcCentimes), nombre: true },
              { titre: 'Regle', rendu: (l) => DA(l.regleCentimes), nombre: true },
              {
                titre: 'Reste du',
                rendu: (l) => (l.resteDuCentimes > 0
                  ? <span className="etiquette orange">{DA(l.resteDuCentimes)}</span>
                  : '—'),
                nombre: true,
              },
              { titre: 'Echeance', rendu: (l) => JOUR(l.dateEcheance) },
            ]} />
        </>
      );

    case 'journal-tresorerie':
      return (
        <>
          <Chiffres cases={[
            { intitule: 'Operations', valeur: String(donnees.totaux.nombreOperations) },
            { intitule: 'Entrees', valeur: DA(donnees.totaux.entreesCentimes) },
            { intitule: 'Sorties', valeur: DA(donnees.totaux.sortiesCentimes) },
            { intitule: 'Solde de la periode', valeur: DA(donnees.totaux.soldeCentimes) },
          ]} />
          <Tableau titre="Par categorie" lignes={donnees.parCategorie}
            vide="Aucun mouvement sur la periode." colonnes={[
              { titre: 'Categorie', rendu: (l) => l.categorie },
              { titre: 'Operations', rendu: (l) => l.nombre, nombre: true },
              { titre: 'Entrees', rendu: (l) => DA(l.entreesCentimes), nombre: true },
              { titre: 'Sorties', rendu: (l) => DA(l.sortiesCentimes), nombre: true },
              { titre: 'Solde', rendu: (l) => DA(l.soldeCentimes), nombre: true },
            ]} />
          <Tableau titre="Operations" lignes={donnees.lignes} colonnes={[
            { titre: 'Date', rendu: (l) => formaterDate(l.date) },
            { titre: 'N°', rendu: (l) => l.numero },
            { titre: 'Compte', rendu: (l) => l.compteLibelle },
            { titre: 'Categorie', rendu: (l) => l.categorie },
            { titre: 'Libelle', rendu: (l) => l.libelle },
            { titre: 'Tiers', rendu: (l) => l.tiersNom ?? '—' },
            {
              titre: 'Entree',
              rendu: (l) => (l.entreeCentimes > 0 ? DA(l.entreeCentimes) : '—'),
              nombre: true,
            },
            {
              titre: 'Sortie',
              rendu: (l) => (l.sortieCentimes > 0 ? DA(l.sortieCentimes) : '—'),
              nombre: true,
            },
            { titre: 'Solde apres', rendu: (l) => DA(l.soldeApresCentimes), nombre: true },
            {
              titre: 'Pointee',
              rendu: (l) => (l.pointee
                ? <span className="etiquette vert">oui</span>
                : <span className="etiquette neutre">non</span>),
            },
          ]} />
        </>
      );

    case 'declaration': {
      const nette = Number(donnees.tvaNetteCentimes);
      return (
        <>
          <Chiffres cases={[
            { intitule: 'Chiffre d’affaires HT', valeur: DA(donnees.ventes.baseHtCentimes) },
            { intitule: 'TVA collectee', valeur: DA(donnees.ventes.tvaCollecteeCentimes) },
            { intitule: 'TVA deductible', valeur: DA(donnees.achats.tvaDeductibleCentimes) },
            {
              intitule: nette >= 0 ? 'TVA nette due' : 'Credit de TVA',
              valeur: DA(Math.abs(nette)),
            },
          ]} />
          <Tableau titre="Ventes par taux de TVA" lignes={donnees.ventes.parTaux}
            vide="Aucune vente sur la periode." colonnes={[
              { titre: 'Taux', rendu: (l) => `${l.taux} %` },
              { titre: 'Lignes', rendu: (l) => l.nombreLignes, nombre: true },
              { titre: 'Base HT', rendu: (l) => DA(l.baseHtCentimes), nombre: true },
              { titre: 'TVA collectee', rendu: (l) => DA(l.tvaCentimes), nombre: true },
              { titre: 'Total TTC', rendu: (l) => DA(l.totalTtcCentimes), nombre: true },
            ]} />
          <Tableau titre="Achats et droit de timbre" lignes={[
            {
              intitule: 'Achats HT', nombre: donnees.achats.nombrePieces,
              montant: donnees.achats.baseHtCentimes,
            },
            {
              intitule: 'TVA deductible sur achats', nombre: null,
              montant: donnees.achats.tvaDeductibleCentimes,
            },
            {
              intitule: 'Droit de timbre sur ventes', nombre: donnees.timbre.nombrePieces,
              montant: donnees.timbre.surVentesCentimes,
            },
            {
              intitule: 'Droit de timbre sur achats', nombre: null,
              montant: donnees.achats.timbreCentimes,
            },
          ]} colonnes={[
            { titre: 'Intitule', rendu: (l) => l.intitule },
            { titre: 'Pieces', rendu: (l) => l.nombre ?? '—', nombre: true },
            { titre: 'Montant', rendu: (l) => DA(l.montant), nombre: true },
          ]} />
          <div className="message info">
            <strong>Ceci n’est pas une declaration remplie.</strong> Seul votre comptable
            peut reporter ces montants dans les cases du formulaire, et le regime fiscal
            exact reste a confirmer avec lui. Ce que GestGlobale garantit, c’est que chaque
            total vient des pieces, au centime, et qu’on peut remonter de ce tableau aux
            lignes qui le composent par le journal des ventes.
            {donnees.regimeATvaNulle && (
              <>
                {' '}Sur cette periode, toutes les ventes sont a TVA 0 : c’est ce que porte
                le catalogue repris de l’ancien logiciel, et c’est precisement le point a
                trancher.
              </>
            )}
          </div>
        </>
      );
    }

    default:
      return null;
  }
}
