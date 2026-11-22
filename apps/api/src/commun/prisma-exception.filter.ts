import {
  ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/**
 * Traduit les erreurs de Prisma en reponses HTTP comprehensibles.
 *
 * Sans ce filtre, demander un document qui n'existe pas rendait une
 * erreur 500 : le serveur avouait une panne la ou il aurait du dire
 * « introuvable ». L'appelant ne pouvait pas faire la difference entre
 * une faute de frappe dans un numero et un serveur en difficulte, et
 * l'ecran affichait « erreur interne » a un gerant qui avait
 * simplement cherche une facture inexistante.
 *
 * Le defaut touchait les dix endroits du serveur qui s'appuient sur
 * `findUniqueOrThrow`. Le corriger ici les couvre tous, et couvrira
 * ceux qu'on ecrira ensuite.
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
export class FiltrePrisma implements ExceptionFilter {
  private readonly logger = new Logger(FiltrePrisma.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reponse = host.switchToHttp().getResponse<Response>();
    const requete = host.switchToHttp().getRequest<{ url?: string }>();

    const { statut, message } = this.traduire(exception);

    // Une erreur qu'on n'a pas su traduire reste une panne : on la
    // journalise, pour qu'elle ne se perde pas derriere un message
    // poli.
    if (statut === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Erreur Prisma non traduite sur ${requete?.url ?? '?'} : ${String(exception)}`,
      );
    }

    reponse.status(statut).json({
      statusCode: statut,
      message,
      error: statut === HttpStatus.NOT_FOUND ? 'Not Found' : 'Bad Request',
    });
  }

  private traduire(exception: unknown): { statut: number; message: string } {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        // Enregistrement demande introuvable (findUniqueOrThrow, update
        // sur une cle absente).
        case 'P2025':
          return {
            statut: HttpStatus.NOT_FOUND,
            message: this.nommer(exception) ?? 'Enregistrement introuvable',
          };
        // Violation d'unicite.
        case 'P2002': {
          const champs = this.champs(exception);
          return {
            statut: HttpStatus.CONFLICT,
            message: champs
              ? `Cette valeur existe deja pour : ${champs}`
              : 'Cette valeur existe deja',
          };
        }
        // Cle etrangere : on designe un enregistrement qui n'existe pas.
        case 'P2003':
          return {
            statut: HttpStatus.BAD_REQUEST,
            message: 'Un des elements references n’existe pas',
          };
        default:
          return {
            statut: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Erreur de base de donnees',
          };
      }
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        statut: HttpStatus.BAD_REQUEST,
        message: 'Requete invalide : un champ attendu manque ou n’a pas le bon type',
      };
    }

    return {
      statut: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Erreur de base de donnees',
    };
  }

  /** Nomme l'entite cherchee quand Prisma la donne. */
  private nommer(exception: Prisma.PrismaClientKnownRequestError): string | null {
    const modele = (exception.meta?.modelName as string | undefined)
      ?? /No (\w+) found/.exec(exception.message)?.[1];
    if (!modele) return null;
    return `${this.enClair(modele)} introuvable`;
  }

  private champs(exception: Prisma.PrismaClientKnownRequestError): string | null {
    const cible = exception.meta?.target;
    if (Array.isArray(cible)) return cible.join(', ');
    if (typeof cible === 'string') return cible;
    return null;
  }

  /** Noms de modeles tels qu'un utilisateur les reconnait. */
  private enClair(modele: string): string {
    const noms: Record<string, string> = {
      DocumentVente: 'Document de vente',
      Article: 'Article',
      Tiers: 'Client ou fournisseur',
      Employe: 'Employe',
      BulletinPaie: 'Bulletin de paie',
      BonAchat: 'Bon d’achat',
      TransfertStock: 'Transfert',
      Utilisateur: 'Utilisateur',
      CompteTresorerie: 'Compte de tresorerie',
      SessionCaisse: 'Session de caisse',
      Magasin: 'Magasin',
      Emplacement: 'Emplacement',
    };
    return noms[modele] ?? modele;
  }
}
