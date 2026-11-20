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
   * Numero de journal interne, tire d'une sequence PostgreSQL.
   *
   * Une sequence ne verrouille rien et monte en charge, contrairement au
   * compteur en table : c'est ce qu'il faut pour les milliers de
   * mouvements de stock d'une journee, ou pour trente caisses qui
   * remontent en meme temps.
   *
   * En contrepartie elle peut laisser des trous si une transaction
   * echoue. C'est acceptable pour un journal interne, et c'est pourquoi
   * les documents a valeur legale continuent d'utiliser `suivant`.
   */
  async sequence(
    prefixe: string,
    nomSequence: string,
    tx?: ClientTransaction,
  ): Promise<string> {
    const client = tx ?? this.prisma;
    const [ligne] = await client.$queryRawUnsafe<Array<{ valeur: bigint }>>(
      `SELECT nextval('${nomSequence}') AS valeur`,
    );
    return `${prefixe}-${String(ligne.valeur).padStart(10, '0')}`;
  }

  /**
   * Numero sequentiel annuel sans trou : RCP-2026-000042.
   *
   * Reserve aux documents a valeur legale, ou l'absence de trou compte.
   * Le compteur est verrouille jusqu'a la fin de la transaction, ce qui
   * serialise les appels : a n'employer que la ou c'est justifie.
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
