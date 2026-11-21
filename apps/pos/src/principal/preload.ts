import { contextBridge, ipcRenderer } from 'electron';

/**
 * Pont entre l'interface et le processus principal.
 *
 * L'interface n'a aucun acces direct a la base locale ni au reseau :
 * tout passe par des canaux nommes, ce qui limite la surface exposee.
 */
const api = {
  configuration: () => ipcRenderer.invoke('caisse:configuration'),
  testerServeur: (urlServeur: string) =>
    ipcRenderer.invoke('caisse:tester-serveur', { urlServeur }),
  enregistrerConfiguration: (saisie: unknown) =>
    ipcRenderer.invoke('caisse:enregistrer-configuration', saisie),

  connexion: (code: string, pin: string) => ipcRenderer.invoke('caisse:connexion', { code, pin }),
  etatSync: () => ipcRenderer.invoke('caisse:etat-sync'),
  synchroniser: () => ipcRenderer.invoke('caisse:synchroniser'),

  sessionCourante: () => ipcRenderer.invoke('caisse:session-courante'),
  ouvrirSession: (fondDeCaisseCentimes: number) =>
    ipcRenderer.invoke('caisse:ouvrir-session', { fondDeCaisseCentimes }),
  previsualiserCloture: (comptage: unknown) =>
    ipcRenderer.invoke('caisse:previsualiser-cloture', { comptage }),
  cloturer: (comptage: unknown, justification: string) =>
    ipcRenderer.invoke('caisse:cloturer', { comptage, justification }),

  chercherCode: (code: string) => ipcRenderer.invoke('caisse:chercher-code', { code }),
  promotionsLigne: (articleId: string, quantiteMilli: number, prixUnitaireCentimes: number) =>
    ipcRenderer.invoke('caisse:promotions-ligne', {
      articleId, quantiteMilli, prixUnitaireCentimes,
    }),
  promotionsEnCours: () => ipcRenderer.invoke('caisse:promotions-en-cours'),
  presenterBon: (code: string, montantCentimes: number) =>
    ipcRenderer.invoke('caisse:presenter-bon', { code, montantCentimes }),
  pointsClient: (clientId: string) => ipcRenderer.invoke('caisse:points-client', { clientId }),
  chercherTexte: (texte: string) => ipcRenderer.invoke('caisse:chercher-texte', { texte }),
  chercherClient: (texte: string) => ipcRenderer.invoke('caisse:chercher-client', { texte }),
  controlerCredit: (clientId: string, montantCentimes: number) =>
    ipcRenderer.invoke('caisse:controler-credit', { clientId, montantCentimes }),

  encaisser: (panier: unknown, reglements: unknown) =>
    ipcRenderer.invoke('caisse:encaisser', { panier, reglements }),
  imprimer: (numero: string) => ipcRenderer.invoke('caisse:imprimer', { numero }),
  ouvrirTiroir: () => ipcRenderer.invoke('caisse:ouvrir-tiroir'),

  surEtatSync: (rappel: (etat: unknown) => void) => {
    const ecouteur = (_: unknown, etat: unknown) => rappel(etat);
    ipcRenderer.on('caisse:etat-sync-change', ecouteur);
    return () => ipcRenderer.removeListener('caisse:etat-sync-change', ecouteur);
  },
};

contextBridge.exposeInMainWorld('caisse', api);

export type ApiCaisse = typeof api;
