import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface EntreeAudit {
  utilisateurId?: string | null;
  action: string;
  entite?: string | null;
  entiteId?: string | null;
  magasinId?: string | null;
  caisseId?: string | null;
  poste?: string | null;
  adresseIp?: string | null;
  details?: Record<string, unknown> | null;
}

/**
 * Serialisation canonique : les clefs des objets sont triees de maniere
 * recursive.
 *
 * Indispensable ici : PostgreSQL stocke le type Json en `jsonb`, qui ne
 * conserve pas l'ordre d'insertion des clefs. Sans tri, l'empreinte
 * recalculee a la relecture differerait de celle calculee a l'ecriture et
 * la chaine paraitrait rompue alors qu'aucune ligne n'aurait bouge.
 */
export function jsonCanonique(valeur: unknown): string {
  if (valeur === null || typeof valeur !== 'object') return JSON.stringify(valeur) ?? 'null';
  if (Array.isArray(valeur)) return `[${valeur.map(jsonCanonique).join(',')}]`;
  const entrees = Object.entries(valeur as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entrees.map(([k, v]) => `${JSON.stringify(k)}:${jsonCanonique(v)}`).join(',')}}`;
}

/**
 * Journal d'audit non modifiable (section 6 du cahier des charges).
 *
 * Chaque entree contient l'empreinte de la precedente. Supprimer ou
 * retoucher une ligne casse la chaine, ce que `verifierIntegrite` detecte.
 * Les ecritures sont sequentielles : le service serialise les appels pour
 * que la chaine reste coherente sous charge.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private file: Promise<unknown> = Promise.resolve();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Journalise une action. N'echoue jamais l'operation metier appelante :
   * une panne d'ecriture d'audit est signalee mais ne fait pas perdre une
   * vente. La perte eventuelle reste visible dans les journaux techniques.
   */
  async journaliser(entree: EntreeAudit): Promise<void> {
    this.file = this.file.then(() => this.ecrire(entree)).catch((erreur) => {
      this.logger.error(`Ecriture du journal d'audit impossible : ${erreur}`);
    });
    await this.file;
  }

  private async ecrire(entree: EntreeAudit): Promise<void> {
    const precedente = await this.prisma.journalAudit.findFirst({
      orderBy: { numero: 'desc' },
      select: { empreinte: true },
    });

    const date = new Date();
    const charge = jsonCanonique({
      date: date.toISOString(),
      utilisateurId: entree.utilisateurId ?? null,
      action: entree.action,
      entite: entree.entite ?? null,
      entiteId: entree.entiteId ?? null,
      magasinId: entree.magasinId ?? null,
      caisseId: entree.caisseId ?? null,
      poste: entree.poste ?? null,
      adresseIp: entree.adresseIp ?? null,
      details: entree.details ?? null,
    });

    const empreintePrecedente = precedente?.empreinte ?? null;
    const empreinte = createHash('sha256')
      .update(`${empreintePrecedente ?? 'origine'}|${charge}`)
      .digest('hex');

    await this.prisma.journalAudit.create({
      data: {
        date,
        utilisateurId: entree.utilisateurId ?? null,
        action: entree.action,
        entite: entree.entite ?? null,
        entiteId: entree.entiteId ?? null,
        magasinId: entree.magasinId ?? null,
        caisseId: entree.caisseId ?? null,
        poste: entree.poste ?? null,
        adresseIp: entree.adresseIp ?? null,
        details: (entree.details ?? null) as never,
        empreintePrecedente,
        empreinte,
      },
    });
  }

  /**
   * Recalcule toute la chaine et retourne la premiere rupture trouvee.
   * A passer periodiquement : c'est la preuve que le journal n'a pas ete
   * retouche directement en base.
   */
  async verifierIntegrite(): Promise<{ intact: boolean; ruptureAuNumero: string | null }> {
    const taille = 1000;
    let curseur: bigint | undefined;
    let attendue: string | null = null;

    for (;;) {
      const lot = curseur === undefined
        ? await this.prisma.journalAudit.findMany({ take: taille, orderBy: { numero: 'asc' } })
        : await this.prisma.journalAudit.findMany({
            take: taille,
            orderBy: { numero: 'asc' },
            cursor: { numero: curseur },
            skip: 1,
          });
      if (lot.length === 0) break;

      for (const ligne of lot) {
        if (ligne.empreintePrecedente !== attendue) {
          return { intact: false, ruptureAuNumero: ligne.numero.toString() };
        }
        const charge = jsonCanonique({
          date: ligne.date.toISOString(),
          utilisateurId: ligne.utilisateurId,
          action: ligne.action,
          entite: ligne.entite,
          entiteId: ligne.entiteId,
          magasinId: ligne.magasinId,
          caisseId: ligne.caisseId,
          poste: ligne.poste,
          adresseIp: ligne.adresseIp,
          details: ligne.details ?? null,
        });
        const recalculee: string = createHash('sha256')
          .update(`${ligne.empreintePrecedente ?? 'origine'}|${charge}`)
          .digest('hex');
        if (recalculee !== ligne.empreinte) {
          return { intact: false, ruptureAuNumero: ligne.numero.toString() };
        }
        attendue = ligne.empreinte;
      }
      curseur = lot[lot.length - 1].numero;
    }

    return { intact: true, ruptureAuNumero: null };
  }
}
