import { Module } from '@nestjs/common';
import { VentesService } from './ventes.service';
import { VentesController } from './ventes.controller';
import { DocumentsVenteService } from './documents.service';
import { DocumentsVenteController } from './documents.controller';
import { StocksModule } from '../stocks/stocks.module';
import { TiersModule } from '../tiers/tiers.module';
import { TresorerieModule } from '../tresorerie/tresorerie.module';

@Module({
  imports: [StocksModule, TiersModule, TresorerieModule],
  providers: [VentesService, DocumentsVenteService],
  controllers: [DocumentsVenteController, VentesController],
  exports: [VentesService, DocumentsVenteService],
})
export class VentesModule {}
