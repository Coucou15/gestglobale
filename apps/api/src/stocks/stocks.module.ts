import { Module } from '@nestjs/common';
import { StocksService } from './stocks.service';
import { InventairesService } from './inventaires.service';
import { StocksController } from './stocks.controller';

@Module({
  providers: [StocksService, InventairesService],
  controllers: [StocksController],
  exports: [StocksService, InventairesService],
})
export class StocksModule {}
