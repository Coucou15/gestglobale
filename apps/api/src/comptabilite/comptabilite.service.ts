import { Injectable } from '@nestjs/common';
import { libelleModePaiement } from '@gestglobale/shared';
import { PrismaService } from '../prisma/prisma.service';
import { c } from '../commun/bigint';

/**
 * Journaux comptables et etats de declaration (M12).
 *
 * Trois journaux — ventes, achats, tresorerie — et un etat de
 * declaration. Ils sortent des memes ecritures que les rapports du
 * gerant, mais presentes comme un comptable les attend : une ligne par
 * piece, dans l'ordre des dates, avec son numero, son tiers et sa
 * ventilation de TVA.
 *
 * Une reserve, qui tient a ce que le client doit encore trancher : le
 * regime fiscal n'est pas confirme et presque tous les produits de son
 * export sont a TVA 0. Tout ce qui en depend — ventilation par taux,
 * TVA collectee et deductible, droit de timbre — est donc calcule a
 * partir de ce que portent les pieces, jamais devine. Si le regime
 * change, ce sont les pieces futures qui changent, pas ce module.
 */
@Injectable()
export class ComptabiliteService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Journal des ventes : une ligne par piece.
   *
   * Les tickets annules y figurent avec leur statut plutot que d'etre
   * retires. Un journal comptable doit montrer qu'une piece a existe
   * puis a ete annulee ; l'effacer laisserait un trou dans la
   * numerotation que personne ne pourrait expliquer.
   */
  async journalVentes(params: { magasinIds: string[]; debut: Date; fin: Date }) {
    const documents = await this.prisma.documentVente.findMany({
      where: {
        magasinId: { in: params.magasinIds },
        dateVente: { gte: params.debut, lt: params.fin },
      },
      orderBy: [{ dateVente: 'asc' }, { numero: 'asc' }],
      include: {
        magasin: { select: { code: true } },
        client: { select: { code: true, raisonSociale: true, nif: true } },
        reglements: { select: { mode: true, montantCentimes: true } },
        lignes: {
          where: { annulee: false },
          select: { tauxTva: true, totalHtCentimes: true, totalTtcCentimes: true },
        },
      },
    });

    const lignes = documents.map((d) => {
      // La TVA est recalculee depuis les lignes plutot que lue sur
      // l'entete : c'est la ventilation par taux qui interesse le
      // comptable, et elle n'existe qu'au niveau des lignes.
      const parTaux = new Map<number, { ht: number; tva: number }>();
      for (const l of d.lignes) {
        const ht = c(l.totalHtCentimes);
        const tva = c(l.totalTtcCentimes) - ht;
        const cumul = parTaux.get(l.tauxTva) ?? { ht: 0, tva: 0 };
        parTaux.set(l.tauxTva, { ht: cumul.ht + ht, tva: cumul.tva + tva });
      }

      return {
        date: d.dateVente,
        magasin: d.magasin.code,
        numero: d.numero,
        type: d.type,
        statut: d.statut,
        clientCode: d.client?.code ?? null,
        clientNom: d.client?.raisonSociale ?? null,
        clientNif: d.client?.nif ?? null,
        totalHtCentimes: c(d.totalHtCentimes),
        totalTvaCentimes: c(d.totalTvaCentimes),
        timbreCentimes: c(d.timbreCentimes),
        remiseCentimes: c(d.remisePiedCentimes),
        totalTtcCentimes: c(d.totalTtcCentimes),
        // Nommes comme sur le ticket et dans les rapports : le comptable
        // doit reconnaitre ce que le client a sous les yeux. La virgule
        // decimale aussi, pour ne pas etre le seul chiffre du fichier a
        // s'ecrire autrement.
        reglements: d.reglements
          .map((r) => `${libelleModePaiement(r.mode)} `
            + `${(c(r.montantCentimes) / 100).toFixed(2).replace('.', ',')}`)
          .join(' + '),
        ventilation: [...parTaux.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([taux, m]) => ({ taux, htCentimes: m.ht, tvaCentimes: m.tva })),
      };
    });

    const valides = lignes.filter((l) => l.statut === 'VALIDE');
    return {
      periode: { debut: params.debut, fin: params.fin },
      lignes,
      totaux: this.totaliser(valides),
      nombreAnnulations: lignes.length - valides.length,
    };
  }

  /** Journal des achats : une ligne par facture fournisseur. */
  async journalAchats(params: { magasinIds: string[]; debut: Date; fin: Date }) {
    const factures = await this.prisma.factureAchat.findMany({
      where: {
        dateFacture: { gte: params.debut, lt: params.fin },
        // Une facture est rattachee a son magasin par sa reception ;
        // sans reception, elle releve du siege et reste visible.
        OR: [
          { reception: { emplacement: { magasinId: { in: params.magasinIds } } } },
          { receptionId: null },
        ],
      },
      orderBy: [{ dateFacture: 'asc' }, { numero: 'asc' }],
      include: {
        fournisseur: { select: { code: true, raisonSociale: true, nif: true, rc: true } },
        reception: {
          select: {
            numero: true,
            emplacement: { select: { magasin: { select: { code: true } } } },
          },
        },
      },
    });

    const lignes = factures.map((f) => ({
      date: f.dateFacture,
      magasin: f.reception?.emplacement.magasin.code ?? 'SIEGE',
      numero: f.numero,
      numeroFournisseur: f.numeroFournisseur,
      receptionNumero: f.reception?.numero ?? null,
      fournisseurCode: f.fournisseur.code,
      fournisseurNom: f.fournisseur.raisonSociale,
      fournisseurNif: f.fournisseur.nif,
      fournisseurRc: f.fournisseur.rc,
      modeReglement: f.modeReglement,
      dateEcheance: f.dateEcheance,
      totalHtCentimes: c(f.totalHtCentimes),
      totalTvaCentimes: c(f.totalTvaCentimes),
      timbreCentimes: c(f.timbreCentimes),
      totalTtcCentimes: c(f.totalTtcCentimes),
      regleCentimes: c(f.regleCentimes),
      resteDuCentimes: c(f.totalTtcCentimes) - c(f.regleCentimes),
    }));

    return {
      periode: { debut: params.debut, fin: params.fin },
      lignes,
      totaux: {
        nombrePieces: lignes.length,
        totalHtCentimes: lignes.reduce((t, l) => t + l.totalHtCentimes, 0),
        totalTvaCentimes: lignes.reduce((t, l) => t + l.totalTvaCentimes, 0),
        timbreCentimes: lignes.reduce((t, l) => t + l.timbreCentimes, 0),
        totalTtcCentimes: lignes.reduce((t, l) => t + l.totalTtcCentimes, 0),
        regleCentimes: lignes.reduce((t, l) => t + l.regleCentimes, 0),
        resteDuCentimes: lignes.reduce((t, l) => t + l.resteDuCentimes, 0),
      },
    };
  }

  /**
   * Journal de tresorerie : toutes les entrees et sorties, par compte.
   *
   * Le solde apres chaque operation est celui enregistre au moment ou
   * elle a eu lieu, pas un recalcul : c'est ce qui permet de retrouver
   * ou un ecart est ne.
   */
  async journalTresorerie(params: {
    magasinIds: string[]; debut: Date; fin: Date; compteId?: string;
  }) {
    const operations = await this.prisma.operationTresorerie.findMany({
      where: {
        date: { gte: params.debut, lt: params.fin },
        ...(params.compteId ? { compteId: params.compteId } : {}),
        compte: {
          OR: [{ magasinId: { in: params.magasinIds } }, { magasinId: null }],
        },
      },
      orderBy: [{ date: 'asc' }, { numero: 'asc' }],
      include: {
        compte: {
          select: {
            code: true, libelle: true, type: true,
            magasin: { select: { code: true } },
          },
        },
        tiers: { select: { code: true, raisonSociale: true } },
      },
    });

    const lignes = operations.map((o) => ({
      date: o.date,
      magasin: o.compte.magasin?.code ?? 'SIEGE',
      numero: o.numero,
      compteCode: o.compte.code,
      compteLibelle: o.compte.libelle,
      compteType: o.compte.type,
      sens: o.sens,
      categorie: o.categorie,
      libelle: o.libelle,
      tiersCode: o.tiers?.code ?? null,
      tiersNom: o.tiers?.raisonSociale ?? null,
      documentNumero: o.documentNumero,
      entreeCentimes: o.sens === 'ENTREE' ? c(o.montantCentimes) : 0,
      sortieCentimes: o.sens === 'SORTIE' ? c(o.montantCentimes) : 0,
      soldeApresCentimes: c(o.soldeApresCentimes),
      pointee: o.pointee,
    }));

    const entrees = lignes.reduce((t, l) => t + l.entreeCentimes, 0);
    const sorties = lignes.reduce((t, l) => t + l.sortieCentimes, 0);

    // Par categorie : c'est la ventilation que le comptable reprend
    // dans son plan de comptes.
    const parCategorie = new Map<string, { entrees: number; sorties: number; nombre: number }>();
    for (const l of lignes) {
      const cumul = parCategorie.get(l.categorie) ?? { entrees: 0, sorties: 0, nombre: 0 };
      parCategorie.set(l.categorie, {
        entrees: cumul.entrees + l.entreeCentimes,
        sorties: cumul.sorties + l.sortieCentimes,
        nombre: cumul.nombre + 1,
      });
    }

    return {
      periode: { debut: params.debut, fin: params.fin },
      lignes,
      parCategorie: [...parCategorie.entries()]
        .map(([categorie, m]) => ({
          categorie,
          nombre: m.nombre,
          entreesCentimes: m.entrees,
          sortiesCentimes: m.sorties,
          soldeCentimes: m.entrees - m.sorties,
        }))
        .sort((a, b) => (b.entreesCentimes + b.sortiesCentimes)
          - (a.entreesCentimes + a.sortiesCentimes)),
      totaux: {
        nombreOperations: lignes.length,
        entreesCentimes: entrees,
        sortiesCentimes: sorties,
        soldeCentimes: entrees - sorties,
        nombreNonPointees: lignes.filter((l) => !l.pointee).length,
      },
    };
  }

  /**
   * Etat pour les declarations (M12).
   *
   * Chiffre d'affaires et TVA par taux, TVA deductible sur achats,
   * droit de timbre. **Ce n'est pas une declaration remplie** : le
   * regime fiscal du client n'est pas confirme, et seul son comptable
   * peut reporter ces montants dans les cases du formulaire. Ce que ce
   * module garantit, c'est que les chiffres sont ceux des pieces, au
   * centime, et qu'on peut remonter de chaque total a ses lignes.
   */
  async etatDeclaration(params: { magasinIds: string[]; debut: Date; fin: Date }) {
    const [ventes, achats, timbres] = await Promise.all([
      this.prisma.$queryRaw<Array<{
        taux: number; ht: bigint | null; ttc: bigint | null; lignes: bigint;
      }>>`
        SELECT l."tauxTva" AS taux,
               SUM(l."totalHtCentimes")  AS ht,
               SUM(l."totalTtcCentimes") AS ttc,
               COUNT(*)                  AS lignes
          FROM "LigneVente" l
          JOIN "DocumentVente" d ON d."id" = l."documentId"
         WHERE d."magasinId" = ANY(${params.magasinIds}::text[])
           AND d."statut" = 'VALIDE' AND l."annulee" = false
           AND d."dateVente" >= ${params.debut} AND d."dateVente" < ${params.fin}
         GROUP BY 1 ORDER BY 1`,

      this.prisma.$queryRaw<Array<{
        ht: bigint | null; tva: bigint | null; timbre: bigint | null; pieces: bigint;
      }>>`
        SELECT SUM(f."totalHtCentimes")  AS ht,
               SUM(f."totalTvaCentimes") AS tva,
               SUM(f."timbreCentimes")   AS timbre,
               COUNT(*)                  AS pieces
          FROM "FactureAchat" f
          LEFT JOIN "Reception" r   ON r."id" = f."receptionId"
          LEFT JOIN "Emplacement" e ON e."id" = r."emplacementId"
         WHERE f."dateFacture" >= ${params.debut} AND f."dateFacture" < ${params.fin}
           AND (e."magasinId" = ANY(${params.magasinIds}::text[]) OR r."id" IS NULL)`,

      this.prisma.$queryRaw<Array<{ timbre: bigint | null; pieces: bigint }>>`
        SELECT SUM("timbreCentimes") AS timbre,
               COUNT(*) FILTER (WHERE "timbreCentimes" > 0) AS pieces
          FROM "DocumentVente"
         WHERE "magasinId" = ANY(${params.magasinIds}::text[])
           AND "statut" = 'VALIDE'
           AND "dateVente" >= ${params.debut} AND "dateVente" < ${params.fin}`,
    ]);

    const parTaux = ventes.map((v) => {
      const ht = c(v.ht);
      const ttc = c(v.ttc);
      return {
        taux: v.taux,
        nombreLignes: Number(v.lignes),
        baseHtCentimes: ht,
        tvaCentimes: ttc - ht,
        totalTtcCentimes: ttc,
      };
    });

    const tvaCollectee = parTaux.reduce((t, l) => t + l.tvaCentimes, 0);
    const tvaDeductible = c(achats[0]?.tva);

    return {
      periode: { debut: params.debut, fin: params.fin },
      ventes: {
        parTaux,
        baseHtCentimes: parTaux.reduce((t, l) => t + l.baseHtCentimes, 0),
        tvaCollecteeCentimes: tvaCollectee,
        totalTtcCentimes: parTaux.reduce((t, l) => t + l.totalTtcCentimes, 0),
      },
      achats: {
        nombrePieces: Number(achats[0]?.pieces ?? 0),
        baseHtCentimes: c(achats[0]?.ht),
        tvaDeductibleCentimes: tvaDeductible,
        timbreCentimes: c(achats[0]?.timbre),
      },
      timbre: {
        surVentesCentimes: c(timbres[0]?.timbre),
        nombrePieces: Number(timbres[0]?.pieces ?? 0),
      },
      /**
       * Difference entre TVA collectee et TVA deductible. Positive,
       * c'est ce qui est du ; negative, c'est un credit reportable.
       * Le comptable tranche : ce chiffre est une soustraction, pas
       * une declaration.
       */
      tvaNetteCentimes: tvaCollectee - tvaDeductible,
      /** Vrai tant qu'aucune vente n'est soumise a TVA. */
      regimeATvaNulle: parTaux.every((l) => l.taux === 0),
    };
  }

  /** Totaux d'un journal de ventes, ventilation par taux comprise. */
  private totaliser(lignes: Array<{
    totalHtCentimes: number; totalTvaCentimes: number;
    timbreCentimes: number; totalTtcCentimes: number;
    ventilation: Array<{ taux: number; htCentimes: number; tvaCentimes: number }>;
  }>) {
    const parTaux = new Map<number, { ht: number; tva: number }>();
    for (const ligne of lignes) {
      for (const v of ligne.ventilation) {
        const cumul = parTaux.get(v.taux) ?? { ht: 0, tva: 0 };
        parTaux.set(v.taux, {
          ht: cumul.ht + v.htCentimes,
          tva: cumul.tva + v.tvaCentimes,
        });
      }
    }
    return {
      nombrePieces: lignes.length,
      totalHtCentimes: lignes.reduce((t, l) => t + l.totalHtCentimes, 0),
      totalTvaCentimes: lignes.reduce((t, l) => t + l.totalTvaCentimes, 0),
      timbreCentimes: lignes.reduce((t, l) => t + l.timbreCentimes, 0),
      totalTtcCentimes: lignes.reduce((t, l) => t + l.totalTtcCentimes, 0),
      parTaux: [...parTaux.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([taux, m]) => ({ taux, htCentimes: m.ht, tvaCentimes: m.tva })),
    };
  }
}
