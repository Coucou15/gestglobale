import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import nodemailer, { type Transporter } from 'nodemailer';
import { formaterDA, libelleModePaiement } from '@gestglobale/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RapportsService } from './rapports.service';
import { formaterJour } from './tableau';

/**
 * Resume quotidien envoye au gerant (M9, section 9).
 *
 * Deux principes.
 *
 * Le resume est **toujours produit et conserve**, meme sans relais de
 * messagerie configure : le gerant le retrouve dans le back-office. Un
 * rapport qu'on ne peut pas envoyer vaut mieux qu'un rapport qui
 * n'existe pas — et c'est precisement ce que le client reprochait a son
 * ancien logiciel, dont les chiffres n'arrivaient jamais nulle part.
 *
 * L'envoi est **une tentative**, pas une condition. Si le relais est
 * absent, injoignable ou mal configure, l'erreur est consignee sur le
 * resume et la journee suivante est traitee normalement. Un serveur de
 * messagerie en panne ne doit pas faire taire le rapport du lendemain.
 */

export interface ReglagesEnvoi {
  /** Faux : le resume est produit mais aucun envoi n'est tente. */
  actif: boolean;
  /** Heure locale de production, en 24 h. Par defaut 7 h. */
  heure: number;
  hote?: string;
  port?: number;
  securise?: boolean;
  utilisateur?: string;
  motDePasse?: string;
  expediteur?: string;
  /**
   * Destinataires explicites. Vide, le resume part aux adresses des
   * gerants du magasin.
   */
  destinataires?: string[];
}

export const REGLAGES_ENVOI_DEFAUT: ReglagesEnvoi = {
  actif: false,
  heure: 7,
};

@Injectable()
export class ResumeService {
  private readonly logger = new Logger(ResumeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rapports: RapportsService,
  ) {}

  async reglages(magasinId?: string): Promise<ReglagesEnvoi> {
    const parametre =
      (magasinId
        ? await this.prisma.parametre.findFirst({
            where: { cle: 'rapports.resumeQuotidien', magasinId },
          })
        : null)
      ?? (await this.prisma.parametre.findFirst({
        where: { cle: 'rapports.resumeQuotidien', magasinId: null },
      }));
    if (!parametre) return REGLAGES_ENVOI_DEFAUT;
    return { ...REGLAGES_ENVOI_DEFAUT, ...(parametre.valeur as object) } as ReglagesEnvoi;
  }

  /**
   * Chaque heure, et non chaque matin a heure fixe : l'heure de
   * production est un reglage du client, qui peut vouloir le resume a
   * 6 h comme a 9 h. On verifie donc a chaque heure ronde si c'est
   * l'heure reglee pour ce magasin.
   */
  @Cron('5 * * * *', { name: 'resume-quotidien' })
  async aLHeureDite(): Promise<void> {
    const heure = new Date().getHours();
    const magasins = await this.prisma.magasin.findMany({
      where: { actif: true },
      select: { id: true, code: true },
    });

    for (const magasin of magasins) {
      const reglages = await this.reglages(magasin.id);
      if (reglages.heure !== heure) continue;
      try {
        await this.produireEtEnvoyer(magasin.id, hier());
      } catch (erreur) {
        // Un magasin en echec ne doit pas empecher les autres.
        this.logger.error(
          `Resume quotidien du magasin ${magasin.code} : ${(erreur as Error).message}`,
        );
      }
    }
  }

  /**
   * Produit le resume d'un jour pour un magasin, le conserve, puis tente
   * l'envoi. Idempotent : relancer la meme journee met le resume a jour
   * au lieu d'en creer un second.
   */
  async produireEtEnvoyer(magasinId: string, jour: Date) {
    const debut = aMinuit(jour);
    const fin = new Date(debut.getTime() + 86400000);

    const magasin = await this.prisma.magasin.findUniqueOrThrow({
      where: { id: magasinId },
      select: { id: true, code: true, nom: true },
    });

    const [synthese, ecarts, ruptures, perte] = await Promise.all([
      this.rapports.periode({ magasinIds: [magasinId], debut, fin }),
      this.rapports.ecartsDeCaisse({ magasinIds: [magasinId], jours: 1 }),
      this.rapports.ruptures({ magasinIds: [magasinId], limite: 1000 }),
      this.rapports.ventesAPerte({ magasinIds: [magasinId], debut, fin }),
    ]);

    const enRupture = ruptures.filter((r) => r.rupture).length;
    const donnees = {
      magasin: { code: magasin.code, nom: magasin.nom },
      jour: debut,
      nombreTickets: synthese.nombreTickets,
      nombreAnnulations: synthese.nombreAnnulations,
      chiffreAffairesTtcCentimes: synthese.chiffreAffairesTtcCentimes,
      margeCentimes: synthese.margeCentimes,
      panierMoyenCentimes: synthese.panierMoyenCentimes,
      parModePaiement: synthese.parModePaiement,
      parCaisse: synthese.parCaisse,
      meilleureHeure: [...synthese.parHeure]
        .sort((a, b) => b.chiffreAffairesCentimes - a.chiffreAffairesCentimes)[0] ?? null,
      ecartsDeCaisseCentimes: ecarts.clotures.reduce((t, z) => t + z.ecartCentimes, 0),
      nombreClotures: ecarts.clotures.length,
      ecartsNonJustifies: ecarts.clotures.filter(
        (z) => z.ecartCentimes !== 0 && !z.justification,
      ).length,
      nombreRuptures: enRupture,
      nombreSousSeuil: ruptures.length - enRupture,
      perteCentimes: perte.perteTotaleCentimes,
      nombreLignesAPerte: perte.nombreLignes,
    };

    const texte = this.composerTexte(donnees);

    const reglages = await this.reglages(magasinId);
    const destinataires = reglages.destinataires?.length
      ? reglages.destinataires
      : await this.gerantsDuMagasin(magasinId);

    const resume = await this.prisma.resumeQuotidien.upsert({
      where: { magasinId_jour: { magasinId, jour: debut } },
      create: { magasinId, jour: debut, donnees, texte, destinataires },
      update: { donnees, texte, destinataires, envoyeLe: null, erreurEnvoi: null },
    });

    const envoi = await this.tenterEnvoi({
      reglages, destinataires, magasin: magasin.nom, jour: debut, texte,
    });

    return this.prisma.resumeQuotidien.update({
      where: { id: resume.id },
      data: { envoyeLe: envoi.envoye ? new Date() : null, erreurEnvoi: envoi.erreur },
    });
  }

  /**
   * Le corps du message.
   *
   * Texte simple, pas HTML : il est lu sur un telephone, souvent sur une
   * connexion lente, et doit rester lisible meme dans un client de
   * messagerie qui n'affiche rien d'autre.
   */
  private composerTexte(d: Record<string, any>): string {
    const DA = (centimes: number) => formaterDA(Number(centimes ?? 0), { devise: true });
    const lignes: string[] = [];

    lignes.push(`${d.magasin.nom} — journee du ${formaterJour(d.jour)}`);
    lignes.push('');
    lignes.push(`Recette TTC        ${DA(d.chiffreAffairesTtcCentimes)}`);
    lignes.push(`Marge              ${DA(d.margeCentimes)}`);
    lignes.push(`Tickets            ${d.nombreTickets}`);
    lignes.push(`Panier moyen       ${DA(d.panierMoyenCentimes)}`);

    if (d.nombreTickets === 0) {
      lignes.push('');
      lignes.push('Aucune vente enregistree ce jour. Si le magasin a ouvert, cela');
      lignes.push('signifie qu’une caisse n’a pas encore remonte ses tickets.');
    }

    if (d.parModePaiement?.length > 0) {
      lignes.push('');
      lignes.push('Reglements');
      // Les montants sont cales a droite : sur quatre modes, une colonne
      // ragee se lit mal au telephone.
      const montants = d.parModePaiement.map((m: any) => DA(m.montantCentimes));
      const largeur = Math.max(...montants.map((t: string) => t.length));
      d.parModePaiement.forEach((m: any, i: number) => {
        lignes.push(
          `  ${libelleModePaiement(String(m.mode)).padEnd(16)}`
          + `${montants[i].padStart(largeur)}`,
        );
      });
    }

    if (d.meilleureHeure) {
      lignes.push('');
      lignes.push(
        `Heure la plus forte : ${d.meilleureHeure.heure}h — `
        + `${DA(d.meilleureHeure.chiffreAffairesCentimes)} `
        + `sur ${d.meilleureHeure.nombreTickets} ticket(s)`,
      );
    }

    lignes.push('');
    lignes.push('Points de vigilance');
    // Une seule largeur d'intitule pour tout le bloc : des colonnes qui
    // se decalent d'une ligne a l'autre se lisent mal sur un telephone.
    const vigilance: Array<[string, string]> = [
      ['Clotures Z', d.nombreClotures === 0
        ? '0  (aucune caisse cloturee)'
        : String(d.nombreClotures)],
      ['Ecart de caisse', DA(d.ecartsDeCaisseCentimes)],
    ];
    if (d.ecartsNonJustifies > 0) {
      vigilance.push(['Ecarts sans motif', `${d.ecartsNonJustifies}  — a justifier`]);
    }
    if (d.nombreAnnulations > 0) {
      vigilance.push(['Tickets annules', String(d.nombreAnnulations)]);
    }
    if (d.nombreLignesAPerte > 0) {
      vigilance.push([
        'Ventes a perte',
        `${d.nombreLignesAPerte} ligne(s), ${DA(d.perteCentimes)}`,
      ]);
    }
    vigilance.push(['Ruptures', String(d.nombreRuptures)]);
    vigilance.push(['Sous le seuil', String(d.nombreSousSeuil)]);

    const largeurIntitule = Math.max(...vigilance.map(([i]) => i.length));
    for (const [intitule, valeur] of vigilance) {
      lignes.push(`  ${intitule.padEnd(largeurIntitule + 2)}${valeur}`);
    }

    lignes.push('');
    lignes.push('— GestGlobale. Le detail et les exports Excel et PDF sont dans le');
    lignes.push('  back-office, rubrique Rapports.');

    return lignes.join('\n');
  }

  /** Adresses des gerants rattaches au magasin. */
  private async gerantsDuMagasin(magasinId: string): Promise<string[]> {
    const gerants = await this.prisma.utilisateur.findMany({
      where: {
        actif: true,
        role: 'GERANT',
        email: { not: null },
        magasins: { some: { magasinId } },
      },
      select: { email: true },
    });
    return gerants.map((g) => g.email!).filter(Boolean);
  }

  private async tenterEnvoi(params: {
    reglages: ReglagesEnvoi;
    destinataires: string[];
    magasin: string;
    jour: Date;
    texte: string;
  }): Promise<{ envoye: boolean; erreur: string | null }> {
    const { reglages, destinataires } = params;

    if (!reglages.actif) {
      return {
        envoye: false,
        erreur: 'Envoi automatique desactive : le resume reste consultable '
          + 'dans le back-office.',
      };
    }
    if (!reglages.hote) {
      return {
        envoye: false,
        erreur: 'Aucun relais de messagerie configure (parametre '
          + 'rapports.resumeQuotidien).',
      };
    }
    if (destinataires.length === 0) {
      return {
        envoye: false,
        erreur: 'Aucun destinataire : renseignez l’adresse du gerant, '
          + 'ou la liste des destinataires dans le parametre.',
      };
    }

    try {
      const transport = this.transport(reglages);
      await transport.sendMail({
        from: reglages.expediteur ?? reglages.utilisateur ?? 'gestglobale@localhost',
        to: destinataires.join(', '),
        subject: `${params.magasin} — resume du ${formaterJour(params.jour)}`,
        text: params.texte,
      });
      return { envoye: true, erreur: null };
    } catch (erreur) {
      const message = (erreur as Error).message;
      this.logger.warn(`Resume quotidien non envoye : ${message}`);
      return { envoye: false, erreur: message };
    }
  }

  private transport(reglages: ReglagesEnvoi): Transporter {
    return nodemailer.createTransport({
      host: reglages.hote,
      port: reglages.port ?? 587,
      secure: reglages.securise ?? false,
      auth: reglages.utilisateur
        ? { user: reglages.utilisateur, pass: reglages.motDePasse ?? '' }
        : undefined,
      // Le serveur du client est sur une liaison ADSL : un relais lent ne
      // doit pas bloquer la tache plus de quelques secondes.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }

  /** Resumes deja produits, les plus recents d'abord. */
  async liste(magasinIds: string[], limite = 30) {
    return this.prisma.resumeQuotidien.findMany({
      where: { magasinId: { in: magasinIds } },
      orderBy: { jour: 'desc' },
      take: Math.min(limite, 365),
      include: { magasin: { select: { code: true, nom: true } } },
    });
  }
}

/** Minuit local du jour donne. */
function aMinuit(jour: Date): Date {
  return new Date(jour.getFullYear(), jour.getMonth(), jour.getDate());
}

function hier(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}
