import { Module } from '@nestjs/common';
import { CandidatesModule } from '../candidates/candidates.module';
import { DetailsController } from './controllers/details.controller';

@Module({
  imports: [CandidatesModule],
  controllers: [DetailsController],
})
export class DetailsModule {}
