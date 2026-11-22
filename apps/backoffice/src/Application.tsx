import { useEffect, useState, type ReactElement } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { appeler, effacerSession, jeton } from './client';
import { Connexion } from './pages/Connexion';
import { TableauDeBord } from './pages/TableauDeBord';
import { Articles } from './pages/Articles';
import { Stocks } from './pages/Stocks';
import { Achats } from './pages/Achats';
import { Documents } from './pages/Documents';
import { Promotions } from './pages/Promotions';
import { Fidelite } from './pages/Fidelite';
import { Rapports } from './pages/Rapports';
import { Transferts } from './pages/Transferts';
import { Comptabilite } from './pages/Comptabilite';
import { Inventaires } from './pages/Inventaires';
import { Caisses } from './pages/Caisses';
import { Tiers } from './pages/Tiers';
import { Tresorerie } from './pages/Tresorerie';
import { Audit } from './pages/Audit';
import { Historique } from './pages/Historique';

export interface Utilisateur {
  id: string;
  code: string;
  nom: string;
  role: string;
  permissions: string[];
  magasins: string[];
}

const ENTREES = [
  { chemin: '/', libelle: 'Tableau de bord', droit: null },
  { chemin: '/articles', libelle: 'Articles', droit: 'article.voir' },
  { chemin: '/stocks', libelle: 'Stocks', droit: 'stock.voir' },
  { chemin: '/promotions', libelle: 'Promotions', droit: 'article.voir' },
  { chemin: '/rapports', libelle: 'Rapports', droit: 'rapport.son_magasin' },
  { chemin: '/fidelite', libelle: 'Fidelite et bons', droit: 'tiers.voir' },
  { chemin: '/documents', libelle: 'Factures et BL', droit: 'rapport.son_magasin' },
  { chemin: '/achats', libelle: 'Receptions', droit: 'achat.voir' },
  { chemin: '/inventaires', libelle: 'Inventaires', droit: 'stock.inventaire_saisir' },
  { chemin: '/transferts', libelle: 'Transferts', droit: 'stock.voir' },
  { chemin: '/caisses', libelle: 'Caisses', droit: 'rapport.son_magasin' },
  { chemin: '/tiers', libelle: 'Clients et fournisseurs', droit: 'tiers.voir' },
  { chemin: '/tresorerie', libelle: 'Tresorerie', droit: 'tresorerie.voir' },
  { chemin: '/historique', libelle: 'Historique repris', droit: 'rapport.son_magasin' },
  { chemin: '/comptabilite', libelle: 'Comptabilite', droit: 'rapport.tous' },
  { chemin: '/audit', libelle: 'Journal d’audit', droit: 'audit.consulter' },
];

/**
 * Route soumise a un droit.
 *
 * Le menu masque deja ce que l'utilisateur ne peut pas voir, mais cela ne
 * suffit pas : l'adresse reste dans la barre du navigateur apres une
 * deconnexion, et peut aussi etre saisie a la main. Sans ce controle, un
 * magasinier qui se connecte apres un gerant retombait sur l'ecran de
 * tresorerie et n'y voyait qu'une erreur.
 */
function RouteProtegee({
  utilisateur,
  droit,
  children,
}: {
  utilisateur: Utilisateur;
  droit: string | null;
  children: ReactElement;
}) {
  if (droit !== null && !utilisateur.permissions.includes(droit)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export function Application() {
  const [utilisateur, setUtilisateur] = useState<Utilisateur | null>(null);
  const [chargement, setChargement] = useState(true);
  const naviguer = useNavigate();

  useEffect(() => {
    if (!jeton()) { setChargement(false); return; }
    appeler<Utilisateur>('/auth/moi')
      .then(setUtilisateur)
      .catch(() => effacerSession())
      .finally(() => setChargement(false));
  }, []);

  if (chargement) {
    return <div className="centre discret">Chargement...</div>;
  }

  if (!utilisateur) {
    return <Connexion surConnexion={setUtilisateur} />;
  }

  const peut = (droit: string | null) => droit === null || utilisateur.permissions.includes(droit);
  const visibles = ENTREES.filter((e) => peut(e.droit));

  return (
    <div className="application">
      <nav className="menu">
        <div className="marque">GestGlobale</div>
        {visibles.map((entree) => (
          <NavLink
            key={entree.chemin}
            to={entree.chemin}
            end={entree.chemin === '/'}
            className={({ isActive }) => (isActive ? 'actif' : '')}
          >
            {entree.libelle}
          </NavLink>
        ))}
        <div className="bas">
          <div className="discret" style={{ padding: 12 }}>
            {utilisateur.nom}
            <br />
            <span style={{ fontSize: 12 }}>{utilisateur.role.replace(/_/g, ' ').toLowerCase()}</span>
          </div>
          <button
            style={{ width: '100%' }}
            onClick={() => {
              effacerSession();
              setUtilisateur(null);
              // On revient a l'accueil : la prochaine personne a se
              // connecter ne doit pas heriter de l'ecran de la precedente.
              naviguer('/', { replace: true });
            }}
          >
            Se deconnecter
          </button>
        </div>
      </nav>

      <main className="contenu">
        <Routes>
          <Route path="/" element={<TableauDeBord utilisateur={utilisateur} />} />
          {([
            ['/articles', 'article.voir', <Articles utilisateur={utilisateur} />],
            ['/stocks', 'stock.voir', <Stocks />],
            ['/promotions', 'article.voir', <Promotions utilisateur={utilisateur} />],
            ['/rapports', 'rapport.son_magasin', <Rapports utilisateur={utilisateur} />],
            ['/fidelite', 'tiers.voir', <Fidelite utilisateur={utilisateur} />],
            ['/documents', 'rapport.son_magasin', <Documents utilisateur={utilisateur} />],
            ['/achats', 'achat.voir', <Achats utilisateur={utilisateur} />],
            ['/inventaires', 'stock.inventaire_saisir', <Inventaires utilisateur={utilisateur} />],
            ['/transferts', 'stock.voir', <Transferts utilisateur={utilisateur} />],
            ['/caisses', 'rapport.son_magasin', <Caisses />],
            ['/tiers', 'tiers.voir', <Tiers />],
            ['/tresorerie', 'tresorerie.voir', <Tresorerie utilisateur={utilisateur} />],
            ['/historique', 'rapport.son_magasin', <Historique />],
            ['/comptabilite', 'rapport.tous', <Comptabilite utilisateur={utilisateur} />],
            ['/audit', 'audit.consulter', <Audit />],
          ] as Array<[string, string, ReactElement]>).map(([chemin, droit, element]) => (
            <Route
              key={chemin}
              path={chemin}
              element={
                <RouteProtegee utilisateur={utilisateur} droit={droit}>
                  {element}
                </RouteProtegee>
              }
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
