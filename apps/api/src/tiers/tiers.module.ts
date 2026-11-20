import { Module } from '@nestjs/common';
import { TiersService } from './tiers.service';
import { TiersController } from './tiers.controller';
import { TresorerieModule } from '../tresorerie/tresorerie.module';

@Module({
  imports: [TresorerieModule],
  providers: [TiersService],
  controllers: [TiersController],
  exports: [TiersService],
})
export class TiersModule {}
