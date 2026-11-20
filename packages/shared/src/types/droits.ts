/**
 * Roles et autorisations — section 6 du cahier des charges.
 *
 * Un utilisateur recoit un role, limite a un ou plusieurs magasins ;
 * chaque droit peut ensuite etre ajoute ou retire individuellement.
 */

export const PERMISSIONS = {
  VENTE_ENCAISSER: 'vente.encaisser',
  VENTE_ANNULER_LIGNE: 'vente.annuler_ligne',
  VENTE_ANNULER_TICKET: 'vente.annuler_ticket',
  VENTE_REMISE_PLAFOND: 'vente.remise_dans_plafond',
  VENTE_REMISE_LIBRE: 'vente.remise_au_dela_plafond',
  VENTE_RETOUR: 'vente.retour_article',
  VENTE_CREDIT: 'vente.a_credit',
  VENTE_FORCER_CREDIT: 'vente.forcer_plafond_credit',

  CAISSE_OUVRIR: 'caisse.ouvrir',
  CAISSE_CLOTURER: 'caisse.cloturer',
  CAISSE_VALIDER_ECART: 'caisse.valider_ecart',
  CAISSE_PRELEVER: 'caisse.prelever',

  ARTICLE_VOIR: 'article.voir',
  ARTICLE_VOIR_ACHAT_MARGE: 'article.voir_prix_achat_et_marge',
  ARTICLE_MODIFIER: 'article.modifier',
  ARTICLE_MODIFIER_PRIX_VENTE: 'article.modifier_prix_vente',
  ARTICLE_MODIFIER_PRIX_MASSE: 'article.modifier_prix_en_masse',

  STOCK_VOIR: 'stock.voir',
  STOCK_RECEPTION: 'stock.reception',
  STOCK_TRANSFERT: 'stock.transfert',
  STOCK_INVENTAIRE_SAISIR: 'stock.inventaire_saisir',
  STOCK_INVENTAIRE_VALIDER: 'stock.inventaire_valider',
  STOCK_CASSE: 'stock.casse_et_peremption',

  ACHAT_VOIR: 'achat.voir',
  ACHAT_COMMANDER: 'achat.commander',
  ACHAT_FACTURER: 'achat.facturer',

  TIERS_VOIR: 'tiers.voir',
  TIERS_MODIFIER: 'tiers.modifier',
  TIERS_BLOQUER: 'tiers.bloquer',

  TRESORERIE_VOIR: 'tresorerie.voir',
  TRESORERIE_SAISIR: 'tresorerie.saisir',
  TRESORERIE_VALIDER_TRANSFERT: 'tresorerie.valider_transfert',

  RAPPORT_SA_CAISSE: 'rapport.sa_caisse',
  RAPPORT_SON_MAGASIN: 'rapport.son_magasin',
  RAPPORT_STOCKS: 'rapport.stocks',
  RAPPORT_ACHATS: 'rapport.achats',
  RAPPORT_TOUS: 'rapport.tous',

  PERSONNEL_VOIR: 'personnel.voir',
  PERSONNEL_GERER: 'personnel.gerer',
  PERSONNEL_PAIE: 'personnel.paie',
  PERSONNEL_SES_DOCUMENTS: 'personnel.ses_documents',

  ACCES_INTERNET: 'acces.internet',
  UTILISATEUR_GERER: 'utilisateur.gerer',
  AUDIT_CONSULTER: 'audit.consulter',
  IMPORT_EXECUTER: 'import.executer',
  PARAMETRE_MODIFIER: 'parametre.modifier',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const TOUTES_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export type CodeRole =
  | 'CAISSIER'
  | 'CHEF_DE_CAISSE'
  | 'MAGASINIER'
  | 'ACHETEUR'
  | 'COMPTABLE'
  | 'GERANT';

/** Matrice exacte du tableau de la section 6. */
export const PERMISSIONS_PAR_ROLE: Record<CodeRole, Permission[]> = {
  CAISSIER: [
    PERMISSIONS.VENTE_ENCAISSER,
    PERMISSIONS.VENTE_RETOUR,
    PERMISSIONS.ARTICLE_VOIR,
    PERMISSIONS.CAISSE_OUVRIR,
    PERMISSIONS.CAISSE_CLOTURER,
    PERMISSIONS.RAPPORT_SA_CAISSE,
    PERMISSIONS.PERSONNEL_SES_DOCUMENTS,
  ],
  CHEF_DE_CAISSE: [
    PERMISSIONS.VENTE_ENCAISSER,
    PERMISSIONS.VENTE_ANNULER_LIGNE,
    PERMISSIONS.VENTE_ANNULER_TICKET,
    PERMISSIONS.VENTE_REMISE_PLAFOND,
    PERMISSIONS.VENTE_REMISE_LIBRE,
    PERMISSIONS.VENTE_RETOUR,
    PERMISSIONS.VENTE_CREDIT,
    PERMISSIONS.CAISSE_OUVRIR,
    PERMISSIONS.CAISSE_CLOTURER,
    PERMISSIONS.CAISSE_PRELEVER,
    PERMISSIONS.ARTICLE_VOIR,
    PERMISSIONS.RAPPORT_SON_MAGASIN,
    PERMISSIONS.PERSONNEL_SES_DOCUMENTS,
  ],
  MAGASINIER: [
    PERMISSIONS.ARTICLE_VOIR,
    PERMISSIONS.ARTICLE_VOIR_ACHAT_MARGE,
    PERMISSIONS.STOCK_VOIR,
    PERMISSIONS.STOCK_RECEPTION,
    PERMISSIONS.STOCK_TRANSFERT,
    PERMISSIONS.STOCK_INVENTAIRE_SAISIR,
    PERMISSIONS.STOCK_CASSE,
    PERMISSIONS.RAPPORT_STOCKS,
    PERMISSIONS.PERSONNEL_SES_DOCUMENTS,
  ],
  ACHETEUR: [
    PERMISSIONS.ARTICLE_VOIR,
    PERMISSIONS.ARTICLE_VOIR_ACHAT_MARGE,
    PERMISSIONS.ARTICLE_MODIFIER,
    PERMISSIONS.ARTICLE_MODIFIER_PRIX_VENTE,
    PERMISSIONS.ARTICLE_MODIFIER_PRIX_MASSE,
    PERMISSIONS.STOCK_VOIR,
    PERMISSIONS.STOCK_RECEPTION,
    PERMISSIONS.STOCK_TRANSFERT,
    PERMISSIONS.STOCK_INVENTAIRE_SAISIR,
    PERMISSIONS.ACHAT_VOIR,
    PERMISSIONS.ACHAT_COMMANDER,
    PERMISSIONS.ACHAT_FACTURER,
    PERMISSIONS.TIERS_VOIR,
    PERMISSIONS.TIERS_MODIFIER,
    PERMISSIONS.RAPPORT_ACHATS,
    PERMISSIONS.ACCES_INTERNET,
    PERMISSIONS.PERSONNEL_SES_DOCUMENTS,
  ],
  COMPTABLE: [
    PERMISSIONS.ARTICLE_VOIR,
    PERMISSIONS.ARTICLE_VOIR_ACHAT_MARGE,
    PERMISSIONS.STOCK_VOIR,
    PERMISSIONS.ACHAT_VOIR,
    PERMISSIONS.TIERS_VOIR,
    PERMISSIONS.TRESORERIE_VOIR,
    PERMISSIONS.TRESORERIE_SAISIR,
    PERMISSIONS.RAPPORT_TOUS,
    PERMISSIONS.PERSONNEL_VOIR,
    PERMISSIONS.PERSONNEL_PAIE,
    PERMISSIONS.ACCES_INTERNET,
    PERMISSIONS.PERSONNEL_SES_DOCUMENTS,
  ],
  GERANT: TOUTES_PERMISSIONS,
};

/** Libelles d'affichage des roles. */
export const LIBELLES_ROLE: Record<CodeRole, string> = {
  CAISSIER: 'Caissier',
  CHEF_DE_CAISSE: 'Chef de caisse',
  MAGASINIER: 'Magasinier',
  ACHETEUR: 'Acheteur',
  COMPTABLE: 'Comptable',
  GERANT: 'Gerant / Admin',
};
