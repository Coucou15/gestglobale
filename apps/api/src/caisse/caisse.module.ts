import { Module } from '@nestjs/common';
import { CaisseService } from './caisse.service';
import { CaisseController } from './caisse.controller';
import { VentesModule } from '../ventes/ventes.module';

@Module({
  imports: [VentesModule],
  providers: [CaisseService],
  controllers: [CaisseController],
  exports: [CaisseService],
})
export class CaisseModule {}
