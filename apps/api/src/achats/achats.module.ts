import { Module } from '@nestjs/common';
import { AchatsService } from './achats.service';
import { AchatsController } from './achats.controller';
import { StocksModule } from '../stocks/stocks.module';
import { TiersModule } from '../tiers/tiers.module';
import { TresorerieModule } from '../tresorerie/tresorerie.module';

@Module({
  imports: [StocksModule, TiersModule, TresorerieModule],
  providers: [AchatsService],
  controllers: [AchatsController],
  exports: [AchatsService],
})
export class AchatsModule {}
