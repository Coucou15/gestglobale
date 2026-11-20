import { Module } from '@nestjs/common';
import { ReferentielController } from './referentiel.controller';

@Module({ controllers: [ReferentielController] })
export class ReferentielModule {}
