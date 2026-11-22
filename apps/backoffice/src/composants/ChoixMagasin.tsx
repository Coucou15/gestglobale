import type { MagasinReferentiel } from './referentiel';

/**
 * Choix du magasin sur lequel on travaille.
 *
 * Les ecrans de saisie prenaient le premier magasin de la liste sans
 * rien dire. Avec une seule superette cela ne se voyait pas ; des la
 * seconde ouverte, le gerant pouvait facturer ou receptionner au nom
 * d'un magasin qu'il n'avait jamais choisi — et le serveur refusait
 * pour stock insuffisant, sans que l'ecran explique pourquoi.
 *
 * Avec un seul magasin, on l'affiche sans deroulant : un choix entre
 * une seule option n'est pas un choix, c'est un encombrement.
 */
export function ChoixMagasin({
  magasins,
  valeur,
  surChoix,
  libelle = 'Magasin',
}: {
  magasins: MagasinReferentiel[];
  valeur: string;
  surChoix: (magasinId: string) => void;
  libelle?: string;
}) {
  if (magasins.length === 0) return null;

  if (magasins.length === 1) {
    return (
      <div className="champ" style={{ marginBottom: 0 }}>
        <label>{libelle}</label>
        <div style={{ paddingTop: 6 }}>
          <strong>{magasins[0].nom}</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="champ" style={{ marginBottom: 0 }}>
      <label htmlFor="choix-magasin">{libelle}</label>
      <select id="choix-magasin" value={valeur} onChange={(e) => surChoix(e.target.value)}>
        {magasins.map((m) => (
          <option key={m.id} value={m.id}>{m.nom}</option>
        ))}
      </select>
    </div>
  );
}
