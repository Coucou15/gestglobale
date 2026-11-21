import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TypePromotion } from '@prisma/client';
import {
  IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength,
} from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';
import { b } from '../commun/bigint';

class PromotionDto {
  @IsString() @MinLength(2) code: string;
  @IsString() @MinLength(2) libelle: string;
  @IsEnum(TypePromotion) type: TypePromotion;
  @IsString() debut: string;
  @IsString() fin: string;
  @IsOptional() @IsString() articleId?: string;
  @IsOptional() @IsString() familleId?: string;
  @IsOptional() @IsInt() @Min(0) valeurCentimes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) remisePourcent?: number;
  @IsOptional() @IsInt() @Min(1) quantiteDeclenchement?: number;
  @IsOptional() @IsInt() @Min(1) quantiteOfferte?: number;
  @IsOptional() @Matches(/^\d{1,2}:\d{2}$/) heureDebut?: string;
  @IsOptional() @Matches(/^\d{1,2}:\d{2}$/) heureFin?: string;
  @IsOptional() @IsBoolean() cumulable?: boolean;
  @IsOptional() @IsBoolean() actif?: boolean;
}

/**
 * Promotions (M10).
 *
 * Le serveur les declare, les caisses les appliquent. Le calcul lui-meme
 * vit dans le paquet partage, pour que le serveur et la caisse donnent
 * le meme montant, hors ligne compris.
 */
@ApiTags('M10 — Promotions')
@Controller('promotions')
export class PromotionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Verifie que la promotion est exploitable avant de la diffuser. */
  private verifier(dto: PromotionDto): void {
    const debut = new Date(dto.debut);
    const fin = new Date(dto.fin);
    if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) {
      throw new BadRequestException('Dates de debut ou de fin illisibles');
    }
    if (fin < debut) throw new BadRequestException('La fin precede le debut');

    switch (dto.type) {
      case TypePromotion.PRIX_BARRE:
        if (!dto.articleId) {
          throw new BadRequestException('Un prix barre vise un article precis');
        }
        if (dto.valeurCentimes === undefined) {
          throw new BadRequestException('Renseignez le prix barre');
        }
        break;
      case TypePromotion.X_POUR_Y:
        if (!dto.articleId) {
          throw new BadRequestException('Un « X pour Y » vise un article precis');
        }
        if (!dto.quantiteDeclenchement || !dto.quantiteOfferte) {
          throw new BadRequestException(
            'Renseignez le nombre d’articles a acheter et le nombre offert',
          );
        }
        break;
      case TypePromotion.REMISE_FAMILLE:
        if (!dto.familleId) throw new BadRequestException('Choisissez une famille');
        if (!dto.remisePourcent) throw new BadRequestException('Renseignez le pourcentage');
        break;
      case TypePromotion.HAPPY_HOUR:
        if (!dto.remisePourcent) throw new BadRequestException('Renseignez le pourcentage');
        if (!dto.heureDebut || !dto.heureFin) {
          throw new BadRequestException('Renseignez la plage horaire');
        }
        break;
    }
  }

  @Get()
  @Droits(PERMISSIONS.ARTICLE_VOIR)
  lister(@Query('actives') actives?: string) {
    const maintenant = new Date();
    return this.prisma.promotion.findMany({
      where:
        actives === 'true'
          ? { actif: true, debut: { lte: maintenant }, fin: { gte: maintenant } }
          : {},
      orderBy: [{ actif: 'desc' }, { debut: 'desc' }],
      take: 200,
      include: {
        article: { select: { reference: true, designation: true } },
        famille: { select: { code: true, nom: true } },
      },
    });
  }

  @Post()
  @Droits(PERMISSIONS.ARTICLE_MODIFIER_PRIX_VENTE)
  async creer(@Body() dto: PromotionDto, @Utilisateur() utilisateur: UtilisateurConnecte) {
    this.verifier(dto);
    const creee = await this.prisma.promotion.create({
      data: {
        code: dto.code,
        libelle: dto.libelle,
        type: dto.type,
        debut: new Date(dto.debut),
        fin: new Date(dto.fin),
        articleId: dto.articleId,
        familleId: dto.familleId,
        valeurCentimes: dto.valeurCentimes !== undefined ? b(dto.valeurCentimes) : null,
        remisePourcent: dto.remisePourcent,
        quantiteDeclenchement: dto.quantiteDeclenchement,
        quantiteOfferte: dto.quantiteOfferte,
        heureDebut: dto.heureDebut,
        heureFin: dto.heureFin,
        cumulable: dto.cumulable ?? false,
        actif: dto.actif ?? true,
      },
    });
    await this.audit.journaliser({
      utilisateurId: utilisateur.id,
      action: 'promotion.creation',
      entite: 'Promotion',
      entiteId: creee.id,
      details: { code: dto.code, type: dto.type },
    });
    return creee;
  }

  /** Active ou suspend une promotion ; la caisse suit a la synchronisation. */
  @Patch(':id')
  @Droits(PERMISSIONS.ARTICLE_MODIFIER_PRIX_VENTE)
  async basculer(
    @Param('id') id: string,
    @Body() dto: { actif: boolean },
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    const promotion = await this.prisma.promotion.update({
      where: { id },
      data: { actif: dto.actif },
    });
    await this.audit.journaliser({
      utilisateurId: utilisateur.id,
      action: dto.actif ? 'promotion.activation' : 'promotion.suspension',
      entite: 'Promotion',
      entiteId: id,
      details: { code: promotion.code },
    });
    return promotion;
  }

  /**
   * Retire une promotion.
   *
   * Une promotion deja appliquee a des ventes n'est pas supprimee mais
   * suspendue : les tickets qui la citent doivent rester explicables.
   */
  @Delete(':id')
  @Droits(PERMISSIONS.ARTICLE_MODIFIER_PRIX_VENTE)
  async retirer(@Param('id') id: string, @Utilisateur() utilisateur: UtilisateurConnecte) {
    const utilisee = await this.prisma.ligneVente.count({ where: { promotionId: id } });
    if (utilisee > 0) {
      await this.prisma.promotion.update({ where: { id }, data: { actif: false } });
      await this.prisma.tombstone.upsert({
        where: { entite_entiteId: { entite: 'Promotion', entiteId: id } },
        create: { entite: 'Promotion', entiteId: id },
        update: { date: new Date() },
      });
      return {
        supprimee: false,
        suspendue: true,
        message: `Cette promotion a servi a ${utilisee} ligne(s) de vente : ` +
          'elle est suspendue, pas supprimee, pour que ces tickets restent explicables.',
      };
    }
    await this.prisma.promotion.delete({ where: { id } });
    await this.prisma.tombstone.upsert({
      where: { entite_entiteId: { entite: 'Promotion', entiteId: id } },
      create: { entite: 'Promotion', entiteId: id },
      update: { date: new Date() },
    });
    await this.audit.journaliser({
      utilisateurId: utilisateur.id,
      action: 'promotion.suppression',
      entite: 'Promotion',
      entiteId: id,
    });
    return { supprimee: true, suspendue: false };
  }
}
