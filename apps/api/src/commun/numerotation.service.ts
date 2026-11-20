import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

type ClientTransaction = Prisma.TransactionClient | PrismaService;

/**
 * Attribution des numeros de documents cote serveur.
 *
 * Les documents nes en caisse portent deja leur numero (SV-03-000125,
 * attribue localement pour rester unique hors ligne). Ce service sert aux
 * documents nes au back-office : receptions, inventaires, operations de
 * tresorerie, bons de commande.
 */
@Injectable()
export class NumerotationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Numero sequentiel annuel : RCP-2026-000042.
   *
   * Le compteur est incremente par un UPDATE atomique, qui verrouille la
   * ligne : deux receptions simultanees ne peuvent pas obtenir le meme
   * numero, et aucun trou n'est creusé tant que la transaction aboutit.
   */
  async suivant(
    prefixe: string,
    options: { annee?: number; tx?: ClientTransaction } = {},
  ): Promise<string> {
    const annee = options.annee ?? new Date().getFullYear();
    const client = options.tx ?? this.prisma;
    const cle = `${prefixe}.${annee}`;

    const [ligne] = await client.$queryRaw<Array<{ valeur: number }>>`
      INSERT INTO "Compteur" ("cle", "valeur", "modifieLe")
      VALUES (${cle}, 1, NOW())
      ON CONFLICT ("cle") DO UPDATE
        SET "valeur" = "Compteur"."valeur" + 1, "modifieLe" = NOW()
      RETURNING "valeur"`;

    return `${prefixe}-${annee}-${String(ligne.valeur).padStart(6, '0')}`;
  }
}
