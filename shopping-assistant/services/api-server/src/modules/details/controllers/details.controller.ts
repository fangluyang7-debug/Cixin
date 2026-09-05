import { Controller, Get, Param } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { CandidatesService } from '../../candidates/application/candidates.service';

@Controller('api/v1/candidates')
export class DetailsController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Get(':candidateItemId')
  async getCandidateDetail(@Param('candidateItemId') candidateItemId: string) {
    return ok(await this.candidatesService.getCandidateDetail(candidateItemId));
  }
}
