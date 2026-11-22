import { useEffect, useState } from 'react';
import { appeler, formaterDA, formaterDate, telecharger } from '../client';
import type { Utilisateur } from '../Application';

/**
 * Gestion du personnel (M13).
 *
 * Dossiers, contrats, pointage, conges, paie et performance. Les
 * salaires ne s'affichent que pour qui porte le droit « personnel.paie »
 * — le gerant et le comptable : c'est la regle de confidentialite de la
 * section 6, et elle se tient aussi a l'ecran, pas seulement au serveur.
 */

interface Onglet { cle: string; libelle: string; droit: string; aide: string }

const ONGLETS: Onglet[] = [
  {
    cle: 'dossiers', libelle: 'Dossiers', droit: 'personnel.voir',
    aide: 'Identite, contrat en cours et compte de caisse rattache.',
  },
  {
    cle: 'pointage', libelle: 'Pointage', droit: 'personnel.voir',
    aide: 'Entrees, sorties et heures travaillees.',
  },
  {
    cle: 'absences', libelle: 'Conges et absences', droit: 'personnel.voir',
    aide: 'Demandes a valider et soldes de conges.',
  },
  {
    cle: 'paie', libelle: 'Paie', droit: 'personnel.paie',
    aide: 'Bulletins du mois et livre de paie.',
  },
  {
    cle: 'performance', libelle: 'Performance', droit: 'personnel.voir',
    aide: 'Ventes, annulations, remises, ecarts de caisse et ponctualite.',
  },
];

const DA = (v: unknown) => formaterDA(Number(v ?? 0));
const JOUR = (v: unknown) => (v ? formaterDate(v as string).slice(0, 10) : '—');

const LIBELLE_CONTRAT: Record<string, string> = {
  CDI: 'CDI', CDD: 'CDD', ESSAI: 'Periode d’essai', TEMPS_PARTIEL: 'Temps partiel',
};
const LIBELLE_ABSENCE: Record<string, string> = {
  CONGE_ANNUEL: 'Conge annuel', MALADIE: 'Maladie',
  INJUSTIFIEE: 'Absence injustifiee', AUTORISATION: 'Autorisation',
};

export function Personnel({ utilisateur }: { utilisateur: Utilisateur }) {
  const peutGerer = utilisateur.permissions.includes('personnel.gerer');
  const voitSalaires = utilisateur.permissions.includes('personnel.paie');
  const visibles = ONGLETS.filter((o) => utilisateur.permissions.includes(o.droit));

  const [onglet, setOnglet] = useState(visibles[0]?.cle ?? 'dossiers');
  const [employes, setEmployes] = useState<any[]>([]);
  const [alertes, setAlertes] = useState<any[]>([]);
  const [donnees, setDonnees] = useState<{ onglet: string; valeur: any } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  /**
   * Afficher aussi les employes sortis.
   *
   * Un dossier ferme ne disparait pas : c'est justement a ce
   * moment-la qu'on delivre un certificat de travail, et le gerant doit
   * pouvoir le retrouver.
   */
  const [avecSortis, setAvecSortis] = useState(false);

  const maintenant = new Date();
  const [annee, setAnnee] = useState(maintenant.getFullYear());
  const [mois, setMois] = useState(maintenant.getMonth() + 1);

  const courant = ONGLETS.find((o) => o.cle === onglet)!;
  const pret = donnees !== null && donnees.onglet === onglet && erreur === null;

  const charger = async () => {
    setErreur(null); setOccupe(true);
    const demande = onglet;
    try {
      let valeur: any;
      if (demande === 'dossiers') {
        valeur = await appeler<any[]>(
          `/personnel/employes${avecSortis ? '?inactifs=true' : ''}`,
        );
        setEmployes(valeur);
      } else if (demande === 'pointage') {
        valeur = await appeler<any[]>('/personnel/pointages');
      } else if (demande === 'absences') {
        valeur = await appeler<any[]>('/personnel/absences');
      } else if (demande === 'paie') {
        valeur = await appeler<any>(`/personnel/paie/livre?annee=${annee}&mois=${mois}`);
      } else {
        valeur = await appeler<any>('/personnel/performance');
      }
      setDonnees({ onglet: demande, valeur });
    } catch (e) {
      setDonnees(null);
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  useEffect(() => {
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet, annee, mois, avecSortis]);

  useEffect(() => {
    void appeler<any[]>('/personnel/alertes-contrats').then(setAlertes).catch(() => undefined);
    if (employes.length === 0) {
      void appeler<any[]>('/personnel/employes').then(setEmployes).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agir = async (action: () => Promise<string>) => {
    setErreur(null); setInfo(null); setOccupe(true);
    try {
      setInfo(await action());
      await charger();
      void appeler<any[]>('/personnel/alertes-contrats').then(setAlertes).catch(() => undefined);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setOccupe(false); }
  };

  const validerAbsence = (a: any, accepte: boolean) => agir(async () => {
    const r = await appeler<any>(`/personnel/absences/${a.id}/validation`, {
      methode: 'POST', corps: { accepte },
    });
    return accepte
      ? `Conge accorde a ${a.employe.prenom} ${a.employe.nom}. `
        + `Solde restant : ${r.soldeCongesApres} jours.`
      : `Demande refusee pour ${a.employe.prenom} ${a.employe.nom}.`;
  });

  const etablirPaie = (employeId: string, nom: string) => agir(async () => {
    const b = await appeler<any>('/personnel/paie/etablir', {
      methode: 'POST', corps: { employeId, annee, mois },
    });
    return `Bulletin ${b.numero} etabli pour ${nom} : `
      + `${formaterDA(b.netAPayerCentimes)} net a payer.`;
  });

  const verser = (bulletinId: string, numero: string) => agir(async () => {
    await appeler(`/personnel/paie/bulletins/${bulletinId}/versement`, { methode: 'POST' });
    return `${numero} marque comme verse.`;
  });

  const sortir = (e: any) => {
    const motif = window.prompt(
      `Enregistrer le depart de ${e.prenom} ${e.nom} ?\n\n`
      + (e.utilisateur
        ? `Son compte « ${e.utilisateur.login} » sera desactive immediatement : `
          + 'son code PIN n’ouvrira plus la caisse.\n\n'
        : '')
      + 'Motif :',
    );
    if (!motif || motif.trim().length < 3) return;
    void agir(async () => {
      const r = await appeler<any>(`/personnel/employes/${e.id}/sortie`, {
        methode: 'POST',
        corps: { dateSortie: new Date().toISOString(), motif: motif.trim() },
      });
      // Le dossier qui vient de se fermer doit rester a l'ecran : c'est
      // maintenant qu'on lui delivre son certificat de travail.
      setAvecSortis(true);
      return r.compteDesactive
        ? `${e.prenom} ${e.nom} est sorti. Le compte « ${r.compteDesactive} » `
          + 'est desactive : ses acces sont coupes.'
        : `${e.prenom} ${e.nom} est sorti.`;
    });
  };

  const telechargerDocument = (chemin: string) => agir(async () => {
    const nom = await telecharger(chemin);
    return `${nom} telecharge.`;
  });

  return (
    <>
      <div className="entete-page">
        <h1>Personnel</h1>
        <span className="espace" />
        {onglet === 'paie' && voitSalaires && (
          <>
            <button disabled={occupe}
              onClick={() => void telechargerDocument(
                `/personnel/paie/livre/export.xlsx?annee=${annee}&mois=${mois}`,
              )}>
              Livre de paie (Excel)
            </button>
            <button disabled={occupe}
              onClick={() => void telechargerDocument(
                `/personnel/paie/livre/export.pdf?annee=${annee}&mois=${mois}`,
              )}>
              PDF
            </button>
          </>
        )}
        {onglet === 'performance' && (
          <button disabled={occupe}
            onClick={() => void telechargerDocument('/personnel/performance/export.pdf')}>
            PDF
          </button>
        )}
      </div>

      {alertes.length > 0 && (
        <div className="message erreur">
          <strong>
            {alertes.length} contrat{alertes.length > 1 ? 's' : ''} arrive
            {alertes.length > 1 ? 'nt' : ''} a terme
          </strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            {alertes.map((a) => (
              <li key={a.id}>
                {a.employe.prenom} {a.employe.nom} — {LIBELLE_CONTRAT[a.type] ?? a.type}
                {a.joursRestants < 0
                  ? ` expire depuis ${-a.joursRestants} jour(s)`
                  : ` dans ${a.joursRestants} jour(s)`}
                {' '}(le {JOUR(a.fin)})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="barre-outils">
        {visibles.map((o) => (
          <button key={o.cle} className={o.cle === onglet ? 'principal' : ''}
            onClick={() => { setOnglet(o.cle); setInfo(null); }}>
            {o.libelle}
          </button>
        ))}
      </div>

      <p className="discret" style={{ marginTop: 0 }}>{courant.aide}</p>

      {onglet === 'dossiers' && (
        <div className="barre-outils">
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={avecSortis} style={{ width: 20, minHeight: 20 }}
              onChange={(e) => setAvecSortis(e.target.checked)} />
            <span>
              Inclure les employes sortis
              <span className="discret"> — leur dossier reste consultable</span>
            </span>
          </label>
        </div>
      )}

      {onglet === 'paie' && (
        <div className="barre-outils">
          <div className="champ" style={{ marginBottom: 0 }}>
            <label htmlFor="mois">Mois</label>
            <select id="mois" value={mois} onChange={(e) => setMois(Number(e.target.value))}>
              {['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet',
                'aout', 'septembre', 'octobre', 'novembre', 'decembre'].map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="champ" style={{ marginBottom: 0 }}>
            <label htmlFor="annee">Annee</label>
            <input id="annee" type="number" value={annee} style={{ width: 110 }}
              onChange={(e) => setAnnee(Number(e.target.value))} />
          </div>
        </div>
      )}

      {erreur && <div className="message erreur">{erreur}</div>}
      {info && <div className="message info">{info}</div>}

      {!pret && <p className="discret">Chargement...</p>}

      {pret && onglet === 'dossiers' && (
        <div className="tableau">
          <table>
            <thead>
              <tr>
                <th>Matricule</th><th>Employe</th><th>Poste</th><th>Magasin</th>
                <th>Contrat</th>
                {voitSalaires && <th className="nombre">Salaire de base</th>}
                <th>Compte</th><th>Conges</th><th />
              </tr>
            </thead>
            <tbody>
              {donnees!.valeur.map((e: any) => {
                const contrat = e.contrats?.[0];
                return (
                  <tr key={e.id}>
                    <td>{e.matricule}</td>
                    <td>
                      {e.prenom} {e.nom}
                      {!e.actif && <> <span className="etiquette rouge">sorti</span></>}
                    </td>
                    <td className="discret">{e.poste ?? '—'}</td>
                    <td className="discret">{e.magasin?.code ?? '—'}</td>
                    <td>
                      {contrat
                        ? <>
                            {LIBELLE_CONTRAT[contrat.type] ?? contrat.type}
                            {contrat.fin && (
                              <div className="discret" style={{ fontSize: 12 }}>
                                jusqu’au {JOUR(contrat.fin)}
                              </div>
                            )}
                          </>
                        : <span className="etiquette orange">sans contrat</span>}
                    </td>
                    {voitSalaires && (
                      <td className="nombre">
                        {contrat ? DA(contrat.salaireBaseCentimes) : '—'}
                      </td>
                    )}
                    <td className="discret">
                      {e.utilisateur
                        ? `${e.utilisateur.login} (code ${e.utilisateur.code})`
                        : '—'}
                    </td>
                    <td className="nombre">{e.soldeCongesJours} j</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button onClick={() => void telechargerDocument(
                        `/personnel/employes/${e.id}/attestation.pdf`
                        + (e.actif ? '' : '?certificat=true'),
                      )}>
                        {e.actif ? 'Attestation' : 'Certificat'}
                      </button>{' '}
                      {peutGerer && e.actif && (
                        <button disabled={occupe} onClick={() => sortir(e)}>Depart</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pret && onglet === 'pointage' && (
        <div className="tableau">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Employe</th><th>Entree</th><th>Sortie</th>
                <th className="nombre">Heures</th><th className="nombre">Retard</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {donnees!.valeur.map((p: any) => (
                <tr key={p.id}>
                  <td>{JOUR(p.date)}</td>
                  <td>{p.employe.prenom} {p.employe.nom}</td>
                  <td>{p.entree ? formaterDate(p.entree).slice(-5) : '—'}</td>
                  <td>{p.sortie ? formaterDate(p.sortie).slice(-5) : '—'}</td>
                  <td className="nombre">{p.heuresTravaillees} h</td>
                  <td className="nombre">
                    {p.minutesRetard > 0
                      ? <span className="etiquette orange">{p.minutesRetard} min</span>
                      : '—'}
                  </td>
                  <td className="discret">
                    {p.source ?? '—'}
                    {p.horsLigne && <> <span className="etiquette neutre">hors ligne</span></>}
                  </td>
                </tr>
              ))}
              {donnees!.valeur.length === 0 && (
                <tr>
                  <td colSpan={7} className="discret centre" style={{ padding: 24 }}>
                    Aucun pointage sur la periode.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {pret && onglet === 'absences' && (
        <div className="tableau">
          <table>
            <thead>
              <tr>
                <th>Employe</th><th>Type</th><th>Du</th><th>Au</th>
                <th className="nombre">Jours</th><th className="nombre">Solde</th>
                <th>Etat</th><th />
              </tr>
            </thead>
            <tbody>
              {donnees!.valeur.map((a: any) => (
                <tr key={a.id}>
                  <td>{a.employe.prenom} {a.employe.nom}</td>
                  <td className="discret">{LIBELLE_ABSENCE[a.type] ?? a.type}</td>
                  <td>{JOUR(a.debut)}</td>
                  <td>{JOUR(a.fin)}</td>
                  <td className="nombre">{a.nombreJours}</td>
                  <td className="nombre">{a.employe.soldeCongesJours} j</td>
                  <td>
                    <span className={`etiquette ${
                      a.statut === 'VALIDEE' ? 'vert'
                        : a.statut === 'REFUSEE' ? 'rouge' : 'orange'}`}>
                      {a.statut.toLowerCase()}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {peutGerer && a.statut === 'DEMANDEE' && (
                      <>
                        <button className="principal" disabled={occupe}
                          onClick={() => void validerAbsence(a, true)}>
                          Accorder
                        </button>{' '}
                        <button disabled={occupe}
                          onClick={() => void validerAbsence(a, false)}>
                          Refuser
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {donnees!.valeur.length === 0 && (
                <tr>
                  <td colSpan={8} className="discret centre" style={{ padding: 24 }}>
                    Aucune demande.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {pret && onglet === 'paie' && (
        <>
          <div className="cartes" style={{ marginBottom: 16 }}>
            <div className="carte">
              <div className="intitule">Bulletins etablis</div>
              <div className="valeur">{donnees!.valeur.totaux.nombreBulletins}</div>
            </div>
            <div className="carte">
              <div className="intitule">Dont verses</div>
              <div className="valeur">{donnees!.valeur.totaux.nombreVerses}</div>
            </div>
            <div className="carte">
              <div className="intitule">Masse salariale brute</div>
              <div className="valeur">{DA(donnees!.valeur.totaux.brutCentimes)}</div>
            </div>
            <div className="carte">
              <div className="intitule">Net a payer</div>
              <div className="valeur">{DA(donnees!.valeur.totaux.netAPayerCentimes)}</div>
            </div>
          </div>

          <div className="tableau" style={{ marginBottom: 20 }}>
            <table>
              <thead>
                <tr>
                  <th>Bulletin</th><th>Employe</th>
                  <th className="nombre">Brut</th><th className="nombre">Cotisations</th>
                  <th className="nombre">IRG</th><th className="nombre">Retenues</th>
                  <th className="nombre">Net a payer</th><th>Etat</th><th />
                </tr>
              </thead>
              <tbody>
                {donnees!.valeur.lignes.map((l: any) => (
                  <tr key={l.numero}>
                    <td>{l.numero}</td>
                    <td>{l.nom}</td>
                    <td className="nombre">{DA(l.brutCentimes)}</td>
                    <td className="nombre">{DA(l.cotisationsCentimes)}</td>
                    <td className="nombre">{DA(l.irgCentimes)}</td>
                    <td className="nombre">{DA(l.retenuesCentimes)}</td>
                    <td className="nombre"><strong>{DA(l.netAPayerCentimes)}</strong></td>
                    <td>
                      {l.payeLe
                        ? <span className="etiquette vert">verse</span>
                        : <span className="etiquette orange">a verser</span>}
                    </td>
                    <td />
                  </tr>
                ))}
                {donnees!.valeur.lignes.length === 0 && (
                  <tr>
                    <td colSpan={9} className="discret centre" style={{ padding: 24 }}>
                      Aucun bulletin etabli pour ce mois.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h2 style={{ fontSize: 17 }}>Etablir la paie</h2>
          <p className="discret" style={{ marginTop: 0 }}>
            Le bulletin se compose de faits deja enregistres : le contrat donne le salaire,
            le pointage les heures, les absences les retenues, les avances ce qui reste a
            rembourser. Rien n’est saisi deux fois.
          </p>
          <div className="tableau">
            <table>
              <thead>
                <tr><th>Matricule</th><th>Employe</th><th>Poste</th><th /></tr>
              </thead>
              <tbody>
                {employes.filter((e: any) => e.actif).map((e: any) => (
                  <tr key={e.id}>
                    <td>{e.matricule}</td>
                    <td>{e.prenom} {e.nom}</td>
                    <td className="discret">{e.poste ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button disabled={occupe}
                        onClick={() => void etablirPaie(e.id, `${e.prenom} ${e.nom}`)}>
                        Etablir le bulletin
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="discret">
            Les taux de cotisations et d’impot viennent d’un bareme parametrable, conserve
            sur chaque bulletin : un bulletin ancien reste justifiable apres un changement
            de taux. <strong>Ces taux doivent etre valides par votre comptable</strong> avant
            la premiere paie.
          </p>
        </>
      )}

      {pret && onglet === 'performance' && (
        <>
          <div className="tableau">
            <table>
              <thead>
                <tr>
                  <th>Matricule</th><th>Employe</th>
                  <th className="nombre">Tickets</th><th className="nombre">CA encaisse</th>
                  <th className="nombre">Panier moyen</th>
                  <th className="nombre">Annulations</th><th className="nombre">Remises</th>
                  <th className="nombre">Ecart caisse</th>
                  <th className="nombre">Jours</th><th className="nombre">Retards</th>
                </tr>
              </thead>
              <tbody>
                {donnees!.valeur.lignes.map((l: any) => (
                  <tr key={l.employeId}>
                    <td>{l.matricule}</td>
                    <td>{l.nom}</td>
                    <td className="nombre">{l.nombreTickets}</td>
                    <td className="nombre">{DA(l.chiffreAffairesCentimes)}</td>
                    <td className="nombre">{DA(l.panierMoyenCentimes)}</td>
                    <td className="nombre">
                      {l.nombreAnnulations > 0
                        ? <span className="etiquette orange">{l.nombreAnnulations}</span>
                        : '—'}
                    </td>
                    <td className="nombre">{DA(l.remisesAccordeesCentimes)}</td>
                    <td className="nombre">{DA(l.ecartCumuleCentimes)}</td>
                    <td className="nombre">{l.joursPointes}</td>
                    <td className="nombre">
                      {l.nombreRetards > 0
                        ? <span className="etiquette orange">{l.nombreRetards}</span>
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="discret">
            Ces chiffres se lisent ensemble. Un caissier rapide qui annule beaucoup n’est pas
            forcement un bon caissier, et un ecart de caisse est en partie structurel : un
            total de ticket tombe sur n’importe quel centime alors que la plus petite coupure
            vaut 5 DA. Ce qui se lit ici, c’est une derive, jamais une faute.
          </p>
        </>
      )}
    </>
  );
}
