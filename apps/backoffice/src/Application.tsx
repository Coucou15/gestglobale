import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { appeler, effacerSession, jeton } from './client';
import { Connexion } from './pages/Connexion';
import { TableauDeBord } from './pages/TableauDeBord';
import { Articles } from './pages/Articles';
import { Stocks } from './pages/Stocks';
import { Caisses } from './pages/Caisses';
import { Tiers } from './pages/Tiers';
import { Tresorerie } from './pages/Tresorerie';
import { Audit } from './pages/Audit';

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
  { chemin: '/caisses', libelle: 'Caisses', droit: 'rapport.son_magasin' },
  { chemin: '/tiers', libelle: 'Clients et fournisseurs', droit: 'tiers.voir' },
  { chemin: '/tresorerie', libelle: 'Tresorerie', droit: 'tresorerie.voir' },
  { chemin: '/audit', libelle: 'Journal d’audit', droit: 'audit.consulter' },
];

export function Application() {
  const [utilisateur, setUtilisateur] = useState<Utilisateur | null>(null);
  const [chargement, setChargement] = useState(true);

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
            onClick={() => { effacerSession(); setUtilisateur(null); }}
          >
            Se deconnecter
          </button>
        </div>
      </nav>

      <main className="contenu">
        <Routes>
          <Route path="/" element={<TableauDeBord utilisateur={utilisateur} />} />
          <Route path="/articles" element={<Articles utilisateur={utilisateur} />} />
          <Route path="/stocks" element={<Stocks />} />
          <Route path="/caisses" element={<Caisses />} />
          <Route path="/tiers" element={<Tiers />} />
          <Route path="/tresorerie" element={<Tresorerie />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
