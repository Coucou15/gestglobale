import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RapportsService } from './rapports.service';
import { ResumeService } from './resume.service';
import { RapportsController } from './rapports.controller';
import { TransfertsModule } from '../transferts/transferts.module';

@Module({
  // Le planificateur sert au resume quotidien (M9, section 9).
  imports: [ScheduleModule.forRoot(), TransfertsModule],
  providers: [RapportsService, ResumeService],
  controllers: [RapportsController],
  exports: [RapportsService, ResumeService],
})
export class RapportsModule {}
