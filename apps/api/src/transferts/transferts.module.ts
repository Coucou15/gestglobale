import { Module } from '@nestjs/common';
import { TransfertsService } from './transferts.service';
import { TransfertsController } from './transferts.controller';
import { StocksModule } from '../stocks/stocks.module';

@Module({
  imports: [StocksModule],
  providers: [TransfertsService],
  controllers: [TransfertsController],
  exports: [TransfertsService],
})
export class TransfertsModule {}
