import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { VentesModule } from '../ventes/ventes.module';
import { CaisseModule } from '../caisse/caisse.module';

@Module({
  imports: [VentesModule, CaisseModule],
  providers: [SyncService],
  controllers: [SyncController],
  exports: [SyncService],
})
export class SyncModule {}
