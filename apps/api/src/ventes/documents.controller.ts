import {
  Body, Controller, Delete, Get, Header, Param, Post, Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TypeDocumentVente } from '@prisma/client';
import { DocumentsVenteService } from './documents.service';
import { composerDocument, type DocumentImprimable } from './impression';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';
import { verifierAccesMagasin } from '../auth/magasin.util';
import { c } from '../commun/bigint';
import {
  CreerDocumentDto, ValiderDocumentDto, TransformerDto,
} from './documents.dto';

@ApiTags('M5 — Documents de vente')
@Controller('ventes/documents')
export class DocumentsVenteController {
  constructor(private readonly documents: DocumentsVenteService) {}

  @Get()
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  lister(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('type') type?: TypeDocumentVente,
    @Query('clientId') clientId?: string,
    @Query('brouillon') brouillon?: string,
    @Query('depuis') depuis?: string,
  ) {
    return this.documents.lister({
      magasinIds: utilisateur.magasins,
      type,
      clientId,
      brouillon: brouillon === undefined ? undefined : brouillon === 'true',
      depuis: depuis ? new Date(depuis) : undefined,
    });
  }

  @Get(':numero')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  parNumero(@Param('numero') numero: string) {
    return this.documents.parNumero(numero);
  }

  /**
   * Document pret a imprimer, en A4.
   *
   * Rendu en HTML : le navigateur imprime ou enregistre en PDF sans
   * qu'un moteur supplementaire soit installe sur le serveur.
   */
  @Get(':numero/impression')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async imprimer(@Param('numero') numero: string): Promise<string> {
    const document = await this.documents.parNumero(numero);
    const imprimable: DocumentImprimable = {
      numero: document.numero,
      type: document.type,
      statut: document.statut,
      brouillon: document.brouillon,
      dateVente: document.dateVente,
      dateEcheance: document.dateEcheance,
      observation: document.observation,
      mentions: document.mentions,
      totalBrutCentimes: c(document.totalBrutCentimes),
      totalRemiseCentimes: c(document.totalRemiseCentimes),
      totalHtCentimes: c(document.totalHtCentimes),
      totalTvaCentimes: c(document.totalTvaCentimes),
      timbreCentimes: c(document.timbreCentimes),
      totalTtcCentimes: c(document.totalTtcCentimes),
      lignes: document.lignes.map((l) => ({
        numeroLigne: l.numeroLigne,
        designation: l.designation,
        quantiteMilli: l.quantiteMilli,
        prixUnitaireCentimes: c(l.prixUnitaireCentimes),
        remisePourcent: l.remisePourcent,
        tauxTva: l.tauxTva,
        totalHtCentimes: c(l.totalHtCentimes),
        totalTtcCentimes: c(l.totalTtcCentimes),
        article: { reference: l.article.reference, unite: l.article.unite },
      })),
      reglements: document.reglements.map((r) => ({
        mode: r.mode, montantCentimes: c(r.montantCentimes),
      })),
      utilisateur: { nom: document.utilisateur.nom },
      documentSource: document.documentSource,
    };
    return composerDocument(imprimable);
  }

  @Post()
  @Droits(PERMISSIONS.VENTE_ENCAISSER)
  creer(@Body() dto: CreerDocumentDto, @Utilisateur() utilisateur: UtilisateurConnecte) {
    verifierAccesMagasin(utilisateur, dto.magasinId);
    return this.documents.creer({ ...dto, utilisateurId: utilisateur.id });
  }

  /** Validation : numero definitif, mentions figees, effets appliques. */
  @Post(':id/valider')
  @Droits(PERMISSIONS.VENTE_ENCAISSER)
  valider(
    @Param('id') id: string,
    @Body() dto: ValiderDocumentDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.documents.valider({ documentId: id, ...dto, utilisateurId: utilisateur.id });
  }

  /** Proforma en facture, bon de livraison en facture, facture en avoir. */
  @Post(':id/transformer')
  @Droits(PERMISSIONS.VENTE_ENCAISSER)
  transformer(
    @Param('id') id: string,
    @Body() dto: TransformerDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.documents.transformer({
      documentId: id, vers: dto.vers, utilisateurId: utilisateur.id,
    });
  }

  @Delete(':id')
  @Droits(PERMISSIONS.VENTE_ENCAISSER)
  supprimer(@Param('id') id: string, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.documents.supprimerBrouillon(id, utilisateur.id);
  }
}
