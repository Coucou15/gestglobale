import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArticlesService } from './articles.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';
import {
  CreerArticleDto, ModifierArticleDto, CodeBarreDto, ChangerPrixDto, ModificationMasseDto,
} from './dto';

@ApiTags('M1 — Articles')
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  /** Le droit de voir les marges conditionne les champs rendus. */
  private avecMarge(utilisateur: UtilisateurConnecte): boolean {
    return utilisateur.permissions.includes(PERMISSIONS.ARTICLE_VOIR_ACHAT_MARGE);
  }

  @Get()
  @Droits(PERMISSIONS.ARTICLE_VOIR)
  rechercher(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('texte') texte?: string,
    @Query('rayonId') rayonId?: string,
    @Query('familleId') familleId?: string,
    @Query('archive') archive?: string,
    @Query('sansCodeBarre') sansCodeBarre?: string,
    @Query('page') page?: string,
    @Query('taille') taille?: string,
  ) {
    return this.articles.rechercher({
      texte,
      rayonId,
      familleId,
      archive: archive === undefined ? undefined : archive === 'true',
      sansCodeBarre: sansCodeBarre === 'true',
      page: page ? Number(page) : 1,
      taille: taille ? Number(taille) : 50,
      avecMarge: this.avecMarge(utilisateur),
    });
  }

  /** Lecture d'un code scanne : code-barres, code vrac ou etiquette balance. */
  @Get('code/:code')
  @Droits(PERMISSIONS.ARTICLE_VOIR)
  parCode(
    @Param('code') code: string,
    @Query('magasinId') magasinId?: string,
  ) {
    return this.articles.parCodeScanne(code, magasinId);
  }

  @Get(':id')
  @Droits(PERMISSIONS.ARTICLE_VOIR)
  parId(@Param('id') id: string, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.articles.parId(id, this.avecMarge(utilisateur));
  }

  @Get(':id/historique-prix')
  @Droits(PERMISSIONS.ARTICLE_VOIR)
  historiquePrix(@Param('id') id: string) {
    return this.articles.historiquePrix(id);
  }

  @Post()
  @Droits(PERMISSIONS.ARTICLE_MODIFIER)
  creer(@Body() dto: CreerArticleDto, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.articles.creer(dto, utilisateur.id);
  }

  @Patch(':id')
  @Droits(PERMISSIONS.ARTICLE_MODIFIER)
  modifier(
    @Param('id') id: string,
    @Body() dto: ModifierArticleDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.articles.modifier(id, dto, utilisateur.id);
  }

  @Post(':id/codes-barres')
  @Droits(PERMISSIONS.ARTICLE_MODIFIER)
  ajouterCode(
    @Param('id') id: string,
    @Body() dto: CodeBarreDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.articles.ajouterCodeBarre(id, dto.code, utilisateur.id);
  }

  @Post(':id/codes-barres/generer')
  @Droits(PERMISSIONS.ARTICLE_MODIFIER)
  genererCode(@Param('id') id: string, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.articles.genererCodeInterne(id, utilisateur.id);
  }

  @Post(':id/prix')
  @Droits(PERMISSIONS.ARTICLE_MODIFIER_PRIX_VENTE)
  changerPrix(
    @Param('id') id: string,
    @Body() dto: ChangerPrixDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.articles.changerPrix(id, dto.categorie, dto.prixCentimes, utilisateur.id, {
      magasinId: dto.magasinId,
      motif: dto.motif,
    });
  }

  /** Modification en masse : simulation par defaut, application sur demande. */
  @Post('prix/modification-masse')
  @Droits(PERMISSIONS.ARTICLE_MODIFIER_PRIX_MASSE)
  modifierEnMasse(
    @Body() dto: ModificationMasseDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.articles.modifierPrixEnMasse(dto, utilisateur.id);
  }
}
