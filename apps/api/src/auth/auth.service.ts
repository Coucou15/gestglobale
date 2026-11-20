import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { permissionsEffectives, horaireAutorise } from './permissions.util';
import { estReseauLocal } from './reseau.util';

const MAX_TENTATIVES = 5;
const DUREE_BLOCAGE_MINUTES = 15;

export interface ContexteConnexion {
  adresseIp: string;
  agent?: string;
  poste?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Empreinte d'un mot de passe ou d'un PIN. Jamais de stockage en clair. */
  static async empreinte(secret: string): Promise<string> {
    return argon2.hash(secret, { type: argon2.argon2id });
  }

  private cidrsLocaux(): string[] {
    return (this.config.get<string>('RESEAU_LOCAL_CIDR') ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  /**
   * Connexion au back-office : login, mot de passe, et double
   * authentification si la demande vient d'Internet (section 6).
   */
  async connexionWeb(
    login: string,
    motDePasse: string,
    codeTotp: string | undefined,
    contexte: ContexteConnexion,
  ) {
    const utilisateur = await this.prisma.utilisateur.findUnique({
      where: { login },
      include: { magasins: true },
    });

    // Message identique dans tous les cas d'echec : ne pas reveler
    // quels logins existent.
    const echec = () => new UnauthorizedException('Identifiants incorrects');

    if (!utilisateur || !utilisateur.actif || !utilisateur.motDePasseHash) {
      await argon2.hash('temps-constant').catch(() => undefined);
      throw echec();
    }
    this.verifierBlocage(utilisateur.bloqueJusqua);

    const correct = await argon2.verify(utilisateur.motDePasseHash, motDePasse).catch(() => false);
    if (!correct) {
      await this.compterEchec(utilisateur.id, utilisateur.tentativesEchouees, contexte);
      throw echec();
    }

    const horaire = horaireAutorise(utilisateur.plagesHoraires);
    if (!horaire.autorise) {
      await this.audit.journaliser({
        utilisateurId: utilisateur.id,
        action: 'connexion.refusee_horaire',
        adresseIp: contexte.adresseIp,
        details: { message: horaire.message },
      });
      throw new ForbiddenException(horaire.message);
    }

    const depuisInternet = !estReseauLocal(contexte.adresseIp, this.cidrsLocaux());
    const exiger2fa = this.config.get<string>('EXIGER_2FA_INTERNET') !== 'false';

    if (depuisInternet && exiger2fa) {
      const permissions = permissionsEffectives(utilisateur);
      if (!permissions.includes('acces.internet')) {
        throw new ForbiddenException("Ce compte n'est pas autorise a se connecter depuis Internet");
      }
      if (!utilisateur.doubleAuthActive || !utilisateur.secretTotp) {
        throw new ForbiddenException(
          "Double authentification obligatoire depuis Internet : activez-la depuis le reseau du magasin",
        );
      }
      if (!codeTotp || !authenticator.verify({ token: codeTotp, secret: utilisateur.secretTotp })) {
        await this.compterEchec(utilisateur.id, utilisateur.tentativesEchouees, contexte);
        throw new UnauthorizedException('Code de double authentification incorrect');
      }
    }

    return this.ouvrirSession(utilisateur, { ...contexte, depuisInternet });
  }

  /**
   * Connexion caisse par code PIN. Le poste doit etre autorise pour
   * l'utilisateur quand une liste de postes est definie.
   */
  async connexionPin(code: string, pin: string, contexte: ContexteConnexion) {
    const utilisateur = await this.prisma.utilisateur.findUnique({
      where: { code },
      include: { magasins: true },
    });
    const echec = () => new UnauthorizedException('Code ou PIN incorrect');

    if (!utilisateur || !utilisateur.actif || !utilisateur.pinHash) throw echec();
    this.verifierBlocage(utilisateur.bloqueJusqua);

    const correct = await argon2.verify(utilisateur.pinHash, pin).catch(() => false);
    if (!correct) {
      await this.compterEchec(utilisateur.id, utilisateur.tentativesEchouees, contexte);
      throw echec();
    }

    const postes = Array.isArray(utilisateur.postesAutorises) ? utilisateur.postesAutorises : [];
    if (postes.length > 0 && contexte.poste && !postes.includes(contexte.poste)) {
      await this.audit.journaliser({
        utilisateurId: utilisateur.id,
        action: 'connexion.poste_non_autorise',
        poste: contexte.poste,
        adresseIp: contexte.adresseIp,
      });
      throw new ForbiddenException("Ce poste n'est pas autorise pour cet utilisateur");
    }

    const horaire = horaireAutorise(utilisateur.plagesHoraires);
    if (!horaire.autorise) throw new ForbiddenException(horaire.message);

    return this.ouvrirSession(utilisateur, { ...contexte, depuisInternet: false });
  }

  private verifierBlocage(bloqueJusqua: Date | null): void {
    if (bloqueJusqua && bloqueJusqua > new Date()) {
      const minutes = Math.ceil((bloqueJusqua.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Compte bloque, reessayez dans ${minutes} minute(s)`);
    }
  }

  private async compterEchec(
    utilisateurId: string,
    tentatives: number,
    contexte: ContexteConnexion,
  ): Promise<void> {
    const nouvelles = tentatives + 1;
    const doitBloquer = nouvelles >= MAX_TENTATIVES;
    await this.prisma.utilisateur.update({
      where: { id: utilisateurId },
      data: {
        tentativesEchouees: doitBloquer ? 0 : nouvelles,
        bloqueJusqua: doitBloquer
          ? new Date(Date.now() + DUREE_BLOCAGE_MINUTES * 60000)
          : undefined,
      },
    });
    await this.audit.journaliser({
      utilisateurId,
      action: doitBloquer ? 'connexion.compte_bloque' : 'connexion.echec',
      adresseIp: contexte.adresseIp,
      poste: contexte.poste,
      details: { tentatives: nouvelles },
    });
  }

  private async ouvrirSession(
    utilisateur: {
      id: string;
      code: string;
      nom: string;
      login: string;
      role: string;
      permissionsAjoutees: unknown;
      permissionsRetirees: unknown;
      magasins: Array<{ magasinId: string }>;
    },
    contexte: ContexteConnexion & { depuisInternet: boolean },
  ) {
    const permissions = permissionsEffectives(utilisateur);
    const magasins = utilisateur.magasins.map((m) => m.magasinId);

    const charge = {
      sub: utilisateur.id,
      code: utilisateur.code,
      nom: utilisateur.nom,
      login: utilisateur.login,
      role: utilisateur.role,
      permissions,
      magasins,
      poste: contexte.poste ?? null,
      depuisInternet: contexte.depuisInternet,
    };

    const jeton = await this.jwt.signAsync(charge, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: this.config.get<string>('JWT_EXPIRATION') ?? '15m',
    });

    const rafraichissement = randomBytes(48).toString('base64url');
    const jours = Number((this.config.get<string>('JWT_REFRESH_EXPIRATION') ?? '7d').replace('d', ''));
    await this.prisma.jetonRafraichissement.create({
      data: {
        utilisateurId: utilisateur.id,
        empreinte: createHash('sha256').update(rafraichissement).digest('hex'),
        expireLe: new Date(Date.now() + (Number.isFinite(jours) ? jours : 7) * 86400000),
        adresseIp: contexte.adresseIp,
        agent: contexte.agent,
      },
    });

    await this.prisma.utilisateur.update({
      where: { id: utilisateur.id },
      data: { derniereConnexion: new Date(), tentativesEchouees: 0, bloqueJusqua: null },
    });

    await this.audit.journaliser({
      utilisateurId: utilisateur.id,
      action: 'connexion.reussie',
      adresseIp: contexte.adresseIp,
      poste: contexte.poste,
      details: { depuisInternet: contexte.depuisInternet },
    });

    return {
      jeton,
      rafraichissement,
      utilisateur: {
        id: utilisateur.id,
        code: utilisateur.code,
        nom: utilisateur.nom,
        role: utilisateur.role,
        permissions,
        magasins,
      },
    };
  }

  async rafraichir(jetonRafraichissement: string, contexte: ContexteConnexion) {
    const empreinte = createHash('sha256').update(jetonRafraichissement).digest('hex');
    const existant = await this.prisma.jetonRafraichissement.findUnique({
      where: { empreinte },
      include: { utilisateur: { include: { magasins: true } } },
    });

    if (!existant || existant.revoqueLe || existant.expireLe < new Date()) {
      throw new UnauthorizedException('Session expiree, reconnectez-vous');
    }
    if (!existant.utilisateur.actif) {
      throw new ForbiddenException('Compte desactive');
    }

    // Rotation : le jeton presente est revoque immediatement.
    await this.prisma.jetonRafraichissement.update({
      where: { id: existant.id },
      data: { revoqueLe: new Date() },
    });

    return this.ouvrirSession(existant.utilisateur, {
      ...contexte,
      depuisInternet: !estReseauLocal(contexte.adresseIp, this.cidrsLocaux()),
    });
  }

  async deconnexion(jetonRafraichissement: string, utilisateurId: string): Promise<void> {
    const empreinte = createHash('sha256').update(jetonRafraichissement).digest('hex');
    await this.prisma.jetonRafraichissement.updateMany({
      where: { empreinte, utilisateurId, revoqueLe: null },
      data: { revoqueLe: new Date() },
    });
    await this.audit.journaliser({ utilisateurId, action: 'deconnexion' });
  }

  /**
   * Verifie un code superviseur sans ouvrir de session : sert aux forcages
   * en caisse (annulation, remise au-dela du plafond, depassement de credit).
   */
  async verifierSuperviseur(
    code: string,
    pin: string,
    permissionRequise: string,
  ): Promise<{ id: string; nom: string }> {
    const utilisateur = await this.prisma.utilisateur.findUnique({ where: { code } });
    if (!utilisateur || !utilisateur.actif || !utilisateur.pinHash) {
      throw new UnauthorizedException('Code superviseur incorrect');
    }
    const correct = await argon2.verify(utilisateur.pinHash, pin).catch(() => false);
    if (!correct) throw new UnauthorizedException('Code superviseur incorrect');

    if (!permissionsEffectives(utilisateur).includes(permissionRequise)) {
      throw new ForbiddenException("Ce superviseur n'a pas ce droit");
    }
    return { id: utilisateur.id, nom: utilisateur.nom };
  }

  /** Prepare l'activation de la double authentification. */
  async preparerDoubleAuth(utilisateurId: string) {
    const utilisateur = await this.prisma.utilisateur.findUniqueOrThrow({
      where: { id: utilisateurId },
    });
    const secret = authenticator.generateSecret();
    await this.prisma.utilisateur.update({
      where: { id: utilisateurId },
      data: { secretTotp: secret, doubleAuthActive: false },
    });
    return {
      secret,
      url: authenticator.keyuri(utilisateur.login, 'GestGlobale', secret),
    };
  }

  async activerDoubleAuth(utilisateurId: string, code: string): Promise<{ active: boolean }> {
    const utilisateur = await this.prisma.utilisateur.findUniqueOrThrow({
      where: { id: utilisateurId },
    });
    if (!utilisateur.secretTotp) {
      throw new BadRequestException("Demandez d'abord un secret de double authentification");
    }
    if (!authenticator.verify({ token: code, secret: utilisateur.secretTotp })) {
      throw new UnauthorizedException('Code incorrect');
    }
    await this.prisma.utilisateur.update({
      where: { id: utilisateurId },
      data: { doubleAuthActive: true },
    });
    await this.audit.journaliser({ utilisateurId, action: 'double_authentification.activee' });
    return { active: true };
  }
}
