import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { CommunModule } from './commun/commun.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ArticlesModule } from './articles/articles.module';
import { StocksModule } from './stocks/stocks.module';
import { TiersModule } from './tiers/tiers.module';
import { TresorerieModule } from './tresorerie/tresorerie.module';
import { AchatsModule } from './achats/achats.module';
import { VentesModule } from './ventes/ventes.module';
import { CaisseModule } from './caisse/caisse.module';
import { SyncModule } from './sync/sync.module';
import { ImportModule } from './import/import.module';
import { RapportsModule } from './rapports/rapports.module';
import { ReferentielModule } from './referentiel/referentiel.module';
import { PromotionsModule } from './promotions/promotions.module';
import { FideliteModule } from './fidelite/fidelite.module';
import { TransfertsModule } from './transferts/transferts.module';
import { ComptabiliteModule } from './comptabilite/comptabilite.module';
import { DroitsGuard } from './auth/droits.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommunModule,
    AuditModule,
    AuthModule,
    ArticlesModule,
    StocksModule,
    TiersModule,
    TresorerieModule,
    AchatsModule,
    VentesModule,
    CaisseModule,
    SyncModule,
    ImportModule,
    RapportsModule,
    TransfertsModule,
    ComptabiliteModule,
    ReferentielModule,
    PromotionsModule,
    FideliteModule,
  ],
  providers: [
    // Toute route est protegee par defaut ; @Public() ouvre explicitement.
    { provide: APP_GUARD, useClass: DroitsGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}
