import { Global, Module } from '@nestjs/common';
import { NumerotationService } from './numerotation.service';

@Global()
@Module({
  providers: [NumerotationService],
  exports: [NumerotationService],
})
export class CommunModule {}
