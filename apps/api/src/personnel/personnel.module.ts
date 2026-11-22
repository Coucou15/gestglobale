import { Module } from '@nestjs/common';
import { PersonnelService } from './personnel.service';
import { PaieService } from './paie.service';
import { PersonnelController } from './personnel.controller';
import { TresorerieModule } from '../tresorerie/tresorerie.module';

@Module({
  imports: [TresorerieModule],
  providers: [PersonnelService, PaieService],
  controllers: [PersonnelController],
  exports: [PersonnelService, PaieService],
})
export class PersonnelModule {}
