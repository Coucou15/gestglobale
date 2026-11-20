import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, CategoriePrix } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { b, c } from '../commun/bigint';
import {
  analyserCodeScanne,
  ean13Valide,
  genererEan13,
  normaliserUnite,
  prixVenteDepuisMarge,
  type UniteMesure,
} from '@gestglobale/shared';
import { CreerArticleDto, ModifierArticleDto, ModificationMasseDto } from './dto';

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Recherche du back-office : par reference, designation ou code-barres.
   * L'index sur designation et la limite de page tiennent l'exigence
   * "recherche dans 30 000 articles en moins d'une seconde" (section 8).
   */
  async rechercher(params: {
    texte?: string;
    rayonId?: string;
    familleId?: string;
    archive?: boolean;
    sansCodeBarre?: boolean;
    page?: number;
    taille?: number;
    avecMarge?: boolean;
  }) {
    const taille = Math.min(params.taille ?? 50, 200);
    const saut = (Math.max(params.page ?? 1, 1) - 1) * taille;
    const texte = params.texte?.trim();

    const where: Prisma.ArticleWhereInput = {
      ...(params.rayonId ? { rayonId: params.rayonId } : {}),
      ...(params.familleId ? { familleId: params.familleId } : {}),
      ...(params.archive === undefined ? {} : { archive: params.archive }),
      ...(params.sansCodeBarre ? { codesBarres: { none: {} } } : {}),
      ...(texte
        ? {
            OR: [
              { reference: { contains: texte, mode: 'insensitive' } },
              { designation: { contains: texte, mode: 'insensitive' } },
              { designationAr: { contains: texte } },
              { codesBarres: { some: { code: texte } } },
            ],
          }
        : {}),
    };

    const [articles, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        take: taille,
        skip: saut,
        orderBy: { designation: 'asc' },
        include: {
          codesBarres: { select: { code: true, principal: true, type: true } },
          prix: { where: { magasinId: null } },
          rayon: { select: { code: true, nom: true } },
          famille: { select: { code: true, nom: true } },
          stocks: { select: { quantiteMilli: true, emplacementId: true } },
        },
      }),
      this.prisma.article.count({ where }),
    ]);

    return {
      total,
      page: params.page ?? 1,
      taille,
      articles: articles.map((a) => this.presenter(a, params.avecMarge ?? false)),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private presenter(article: any, avecMarge: boolean) {
    const prix: Record<string, number> = {};
    for (const p of article.prix ?? []) prix[p.categorie] = c(p.prixCentimes);
    const stockTotalMilli = (article.stocks ?? []).reduce(
      (t: number, s: { quantiteMilli: number }) => t + s.quantiteMilli,
      0,
    );

    const base = {
      id: article.id,
      reference: article.reference,
      designation: article.designation,
      designationAr: article.designationAr,
      type: article.type,
      unite: article.unite,
      decimales: article.decimales,
      tauxTva: article.tauxTva,
      estVrac: article.estVrac,
      packDeId: article.packDeId,
      packNbUnites: article.packNbUnites,
      archive: article.archive,
      venteAutorisee: article.venteAutorisee,
      rayon: article.rayon,
      famille: article.famille,
      codesBarres: (article.codesBarres ?? []).map((cb: { code: string }) => cb.code),
      prix,
      stockTotalMilli,
    };

    // Les prix d'achat et la marge sont reserves aux roles qui y ont droit
    // (section 6 : un caissier ne voit jamais la marge).
    if (!avecMarge) return base;

    const cump = c(article.cumpCentimes);
    const detail = prix[CategoriePrix.DETAIL] ?? 0;
    return {
      ...base,
      cumpCentimes: cump,
      dernierPrixAchatCentimes: c(article.dernierPrixAchatCentimes),
      margeCentimes: detail - cump,
      margePourcent: detail > 0 ? Math.round(((detail - cump) / detail) * 10000) / 100 : 0,
      venteAPerte: detail > 0 && detail < cump,
    };
  }

  async parId(id: string, avecMarge = false) {
    const article = await this.prisma.article.findUnique({
      where: { id },
      include: {
        codesBarres: true,
        codesVrac: true,
        prix: true,
        rayon: true,
        famille: true,
        gamme: true,
        marque: true,
        stocks: { include: { emplacement: true } },
        packDe: { select: { id: true, reference: true, designation: true } },
      },
    });
    if (!article) throw new NotFoundException('Article introuvable');
    return { ...this.presenter(article, avecMarge), detail: article };
  }

  /**
   * Recherche par code scanne : gere les codes-barres secondaires, les
   * codes vrac et les etiquettes balance a poids ou prix incorpore (M1).
   */
  async parCodeScanne(code: string, magasinId?: string) {
    const lu = analyserCodeScanne(code);

    let article = await this.prisma.article.findFirst({
      where: { codesBarres: { some: { code: lu.codeRecherche } } },
      include: { prix: true, codesBarres: true },
    });

    if (!article) {
      const vrac = await this.prisma.codeVrac.findUnique({
        where: { code: lu.codeRecherche },
        include: { article: { include: { prix: true, codesBarres: true } } },
      });
      article = vrac?.article ?? null;
    }
    if (!article) {
      article = await this.prisma.article.findUnique({
        where: { reference: lu.codeRecherche },
        include: { prix: true, codesBarres: true },
      });
    }
    if (!article) throw new NotFoundException(`Aucun article pour le code ${code}`);

    // Un prix defini pour le magasin prime sur le prix du siege (M11).
    const prixMagasin = article.prix.find(
      (p) => p.magasinId === magasinId && p.categorie === CategoriePrix.DETAIL,
    );
    const prixSiege = article.prix.find(
      (p) => p.magasinId === null && p.categorie === CategoriePrix.DETAIL,
    );
    const prixUnitaire = c(prixMagasin?.prixCentimes ?? prixSiege?.prixCentimes ?? 0);

    return {
      article: this.presenter(article, false),
      codeScanne: code,
      codePoids: lu.codePoids,
      // Une etiquette a poids impose la quantite ; une etiquette a prix
      // impose le montant de la ligne, quantite 1.
      quantiteMilli: lu.poidsMilli ?? 1000,
      prixUnitaireCentimes: lu.prixCentimes ?? prixUnitaire,
      prixImpose: lu.prixCentimes !== undefined,
    };
  }

  async creer(dto: CreerArticleDto, utilisateurId: string) {
    const unite = normaliserUnite(dto.unite).unite;
    await this.verifierCodesLibres(dto.codesBarres ?? []);

    const article = await this.prisma.$transaction(async (tx) => {
      const cree = await tx.article.create({
        data: {
          reference: dto.reference,
          designation: dto.designation,
          designationAr: dto.designationAr,
          type: dto.type,
          unite,
          decimales: dto.decimales ?? (unite === 'UN' ? 0 : 3),
          rayonId: dto.rayonId,
          familleId: dto.familleId,
          gammeId: dto.gammeId,
          marqueId: dto.marqueId,
          tauxTva: dto.tauxTva ?? 0,
          estVrac: dto.estVrac ?? false,
          packDeId: dto.packDeId,
          packNbUnites: dto.packNbUnites,
          gestionLot: dto.gestionLot ?? false,
          joursAlertePeremption: dto.joursAlertePeremption ?? 0,
        },
      });

      for (const code of dto.codesBarres ?? []) {
        await tx.codeBarre.create({
          data: {
            articleId: cree.id,
            code,
            type: ean13Valide(code) ? 'EAN13' : 'INTERNE',
            principal: code === dto.codesBarres?.[0],
          },
        });
      }
      for (const [categorie, prixCentimes] of Object.entries(dto.prix ?? {})) {
        await tx.prixArticle.create({
          data: {
            articleId: cree.id,
            categorie: categorie as CategoriePrix,
            prixCentimes: b(prixCentimes as number),
          },
        });
      }
      return cree;
    });

    await this.audit.journaliser({
      utilisateurId,
      action: 'article.creation',
      entite: 'Article',
      entiteId: article.id,
      details: { reference: article.reference, designation: article.designation },
    });
    return this.parId(article.id, true);
  }

  async modifier(id: string, dto: ModifierArticleDto, utilisateurId: string) {
    const avant = await this.prisma.article.findUnique({ where: { id } });
    if (!avant) throw new NotFoundException('Article introuvable');

    const article = await this.prisma.article.update({
      where: { id },
      data: {
        ...(dto.designation !== undefined ? { designation: dto.designation } : {}),
        ...(dto.designationAr !== undefined ? { designationAr: dto.designationAr } : {}),
        ...(dto.unite !== undefined ? { unite: normaliserUnite(dto.unite).unite } : {}),
        ...(dto.decimales !== undefined ? { decimales: dto.decimales } : {}),
        ...(dto.rayonId !== undefined ? { rayonId: dto.rayonId } : {}),
        ...(dto.familleId !== undefined ? { familleId: dto.familleId } : {}),
        ...(dto.tauxTva !== undefined ? { tauxTva: dto.tauxTva } : {}),
        ...(dto.venteAutorisee !== undefined ? { venteAutorisee: dto.venteAutorisee } : {}),
        ...(dto.archive !== undefined ? { archive: dto.archive } : {}),
        ...(dto.gestionLot !== undefined ? { gestionLot: dto.gestionLot } : {}),
      },
    });

    await this.audit.journaliser({
      utilisateurId,
      action: 'article.modification',
      entite: 'Article',
      entiteId: id,
      details: { avant: { designation: avant.designation, archive: avant.archive }, apres: dto },
    });
    return this.parId(article.id, true);
  }

  /** Ajoute un code-barres en verifiant son unicite sur tout le catalogue. */
  async ajouterCodeBarre(articleId: string, code: string, utilisateurId: string) {
    await this.verifierCodesLibres([code]);
    const cree = await this.prisma.codeBarre.create({
      data: { articleId, code, type: ean13Valide(code) ? 'EAN13' : 'INTERNE' },
    });
    await this.audit.journaliser({
      utilisateurId,
      action: 'article.code_barre_ajoute',
      entite: 'Article',
      entiteId: articleId,
      details: { code },
    });
    return cree;
  }

  private async verifierCodesLibres(codes: string[]): Promise<void> {
    if (codes.length === 0) return;
    const doublonsInternes = codes.filter((v, i) => codes.indexOf(v) !== i);
    if (doublonsInternes.length > 0) {
      throw new BadRequestException(`Code repete dans la demande : ${doublonsInternes.join(', ')}`);
    }
    const existants = await this.prisma.codeBarre.findMany({
      where: { code: { in: codes } },
      include: { article: { select: { reference: true, designation: true } } },
    });
    if (existants.length > 0) {
      const details = existants
        .map((e) => `${e.code} deja porte par ${e.article.reference} (${e.article.designation})`)
        .join(' ; ');
      throw new ConflictException(details);
    }
  }

  /** Genere un code-barres interne EAN-13 libre. */
  async genererCodeInterne(articleId: string, utilisateurId: string) {
    for (let tentative = 0; tentative < 50; tentative++) {
      const base = `2000${String(Date.now() % 100000000).padStart(8, '0')}`.slice(0, 12);
      const code = genererEan13(base);
      const existe = await this.prisma.codeBarre.findUnique({ where: { code } });
      if (!existe) return this.ajouterCodeBarre(articleId, code, utilisateurId);
    }
    throw new ConflictException('Impossible de generer un code interne libre');
  }

  /**
   * Changement de prix unitaire : ecrit toujours l'historique (qui, quand,
   * ancien et nouveau prix) exige par M1.
   */
  async changerPrix(
    articleId: string,
    categorie: CategoriePrix,
    nouveauPrixCentimes: number,
    utilisateurId: string,
    options: { magasinId?: string | null; motif?: string; lotModificationId?: string } = {},
  ) {
    const magasinId = options.magasinId ?? null;
    const existant = await this.prisma.prixArticle.findFirst({
      where: { articleId, magasinId, categorie },
    });
    const ancien = c(existant?.prixCentimes);
    if (ancien === nouveauPrixCentimes) return { modifie: false, ancien, nouveau: ancien };

    await this.prisma.$transaction(async (tx) => {
      if (existant) {
        await tx.prixArticle.update({
          where: { id: existant.id },
          data: { prixCentimes: b(nouveauPrixCentimes), actifDepuis: new Date() },
        });
      } else {
        await tx.prixArticle.create({
          data: { articleId, magasinId, categorie, prixCentimes: b(nouveauPrixCentimes) },
        });
      }
      await tx.historiquePrix.create({
        data: {
          articleId,
          magasinId,
          categorie,
          ancienPrixCentimes: b(ancien),
          nouveauPrixCentimes: b(nouveauPrixCentimes),
          motif: options.motif,
          lotModificationId: options.lotModificationId,
          utilisateurId,
        },
      });
    });

    return { modifie: true, ancien, nouveau: nouveauPrixCentimes };
  }

  /**
   * Modification de prix en masse par famille, rayon ou fournisseur,
   * en pourcentage, en montant ou par taux de marge cible (M1).
   * Retourne une simulation tant que `appliquer` est faux.
   */
  async modifierPrixEnMasse(dto: ModificationMasseDto, utilisateurId: string) {
    const where: Prisma.ArticleWhereInput = {
      archive: false,
      ...(dto.familleId ? { familleId: dto.familleId } : {}),
      ...(dto.rayonId ? { rayonId: dto.rayonId } : {}),
      ...(dto.articleIds?.length ? { id: { in: dto.articleIds } } : {}),
      ...(dto.fournisseurId
        ? { lignesReception: { some: { reception: { fournisseurId: dto.fournisseurId } } } }
        : {}),
    };

    const articles = await this.prisma.article.findMany({
      where,
      include: { prix: { where: { magasinId: dto.magasinId ?? null, categorie: dto.categorie } } },
      take: 5000,
    });

    const lotId = `masse-${Date.now()}`;
    const lignes = articles.map((article) => {
      const ancien = c(article.prix[0]?.prixCentimes);
      let nouveau: number;
      switch (dto.mode) {
        case 'POURCENTAGE':
          nouveau = Math.round(ancien * (1 + dto.valeur / 100));
          break;
        case 'MONTANT':
          nouveau = ancien + Math.round(dto.valeur);
          break;
        case 'MARGE_CIBLE':
          nouveau = prixVenteDepuisMarge(c(article.cumpCentimes), dto.valeur);
          break;
        default:
          throw new BadRequestException(`Mode inconnu : ${dto.mode}`);
      }
      if (dto.arrondiCentimes && dto.arrondiCentimes > 0) {
        nouveau = Math.round(nouveau / dto.arrondiCentimes) * dto.arrondiCentimes;
      }
      nouveau = Math.max(0, nouveau);
      const cump = c(article.cumpCentimes);
      return {
        articleId: article.id,
        reference: article.reference,
        designation: article.designation,
        ancienPrixCentimes: ancien,
        nouveauPrixCentimes: nouveau,
        cumpCentimes: cump,
        // Signale les lignes qui passeraient sous le cout d'achat.
        venteAPerte: nouveau > 0 && nouveau < cump,
      };
    });

    if (!dto.appliquer) {
      return { simulation: true, lotModificationId: null, nombre: lignes.length, lignes };
    }

    const aPerte = lignes.filter((l) => l.venteAPerte);
    if (aPerte.length > 0 && !dto.accepterVenteAPerte) {
      throw new BadRequestException(
        `${aPerte.length} article(s) passeraient sous leur cout d'achat. ` +
          `Relancez avec accepterVenteAPerte pour confirmer.`,
      );
    }

    let modifies = 0;
    for (const ligne of lignes) {
      const r = await this.changerPrix(
        ligne.articleId,
        dto.categorie,
        ligne.nouveauPrixCentimes,
        utilisateurId,
        { magasinId: dto.magasinId, motif: dto.motif ?? 'Modification en masse', lotModificationId: lotId },
      );
      if (r.modifie) modifies++;
    }

    await this.audit.journaliser({
      utilisateurId,
      action: 'article.prix_modifies_en_masse',
      entite: 'Article',
      details: {
        lotModificationId: lotId,
        mode: dto.mode,
        valeur: dto.valeur,
        categorie: dto.categorie,
        nombre: modifies,
        venteAPerte: aPerte.length,
      },
    });

    return { simulation: false, lotModificationId: lotId, nombre: modifies, lignes };
  }

  /** Historique des changements de prix d'un article (M1). */
  historiquePrix(articleId: string) {
    return this.prisma.historiquePrix.findMany({
      where: { articleId },
      orderBy: { date: 'desc' },
      take: 200,
      include: { utilisateur: { select: { code: true, nom: true } } },
    });
  }
}
