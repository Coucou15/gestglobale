import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { Droits } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';

@ApiTags('Audit')
@Controller('audit')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Droits(PERMISSIONS.AUDIT_CONSULTER)
  async lister(
    @Query('utilisateurId') utilisateurId?: string,
    @Query('action') action?: string,
    @Query('entite') entite?: string,
    @Query('depuis') depuis?: string,
    @Query('jusqua') jusqua?: string,
    @Query('page') page = '1',
    @Query('taille') taille = '50',
  ) {
    const prise = Math.min(Number(taille) || 50, 200);
    const saut = (Math.max(Number(page) || 1, 1) - 1) * prise;

    const where = {
      ...(utilisateurId ? { utilisateurId } : {}),
      ...(action ? { action: { contains: action, mode: 'insensitive' as const } } : {}),
      ...(entite ? { entite } : {}),
      ...(depuis || jusqua
        ? {
            date: {
              ...(depuis ? { gte: new Date(depuis) } : {}),
              ...(jusqua ? { lte: new Date(jusqua) } : {}),
            },
          }
        : {}),
    };

    const [lignes, total] = await Promise.all([
      this.prisma.journalAudit.findMany({
        where,
        orderBy: { numero: 'desc' },
        take: prise,
        skip: saut,
        include: { utilisateur: { select: { code: true, nom: true } } },
      }),
      this.prisma.journalAudit.count({ where }),
    ]);

    return { total, page: Number(page) || 1, taille: prise, lignes };
  }

  /** Verifie que la chaine d'empreintes n'a pas ete rompue. */
  @Get('integrite')
  @Droits(PERMISSIONS.AUDIT_CONSULTER)
  verifier() {
    return this.audit.verifierIntegrite();
  }
}
