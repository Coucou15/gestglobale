import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { installerSerialisationBigInt } from './commun/bigint';

async function demarrer(): Promise<void> {
  installerSerialisationBigInt();

  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Une caisse restee hors ligne plusieurs jours remonte des centaines de
  // tickets d'un coup. La limite par defaut d'Express (100 Ko) ferait
  // echouer cette remontee indefiniment : la caisse ne pourrait jamais se
  // vider. On la porte a 25 Mo, ce qui couvre largement les 7 jours
  // d'autonomie exiges par la section 4.
  const tailleMaxCorps = process.env.TAILLE_MAX_CORPS ?? '25mb';
  app.use(json({ limit: tailleMaxCorps }));
  app.use(urlencoded({ extended: true, limit: tailleMaxCorps }));

  app.use(helmet());
  app.enableCors({ origin: true, credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const configuration = new DocumentBuilder()
    .setTitle('GestGlobale — API du serveur central')
    .setDescription(
      "ERP des superettes : articles, stocks, achats, caisse, ventes, tiers, tresorerie, droits. " +
        "Les montants sont en centimes de dinar, les quantites en milli-unites.",
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/doc', app, SwaggerModule.createDocument(app, configuration));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('GestGlobale').log(`Serveur central demarre sur le port ${port}`);
}

void demarrer();
