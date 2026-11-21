import { Module } from '@nestjs/common';
import { FideliteService } from './fidelite.service';
import { FideliteController } from './fidelite.controller';

@Module({
  providers: [FideliteService],
  controllers: [FideliteController],
  exports: [FideliteService],
})
export class FideliteModule {}
