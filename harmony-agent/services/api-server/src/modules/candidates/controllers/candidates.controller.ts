import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { CandidatesService } from '../application/candidates.service';
import { MoreCandidatesDto } from '../dto/more-candidates.dto';
import { ShortlistCandidateDto } from '../dto/shortlist-candidate.dto';

@Controller('api/v1/sessions')
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Get(':sessionId/candidates')
  async getCandidates(@Param('sessionId') sessionId: string) {
    return ok(await this.candidatesService.getCurrentCandidates(sessionId));
  }

  @Post(':sessionId/candidates/more')
  async getMoreCandidates(
    @Param('sessionId') sessionId: string,
    @Body() dto: MoreCandidatesDto,
  ) {
    return ok(await this.candidatesService.getMoreCandidates(sessionId, dto ?? {}));
  }

  @Get(':sessionId/cart')
  async getSessionCart(@Param('sessionId') sessionId: string) {
    return ok(await this.candidatesService.getSessionCart(sessionId));
  }

  @Post(':sessionId/candidates/:candidateItemId/shortlist')
  async shortlistCandidate(
    @Param('sessionId') sessionId: string,
    @Param('candidateItemId') candidateItemId: string,
    @Body() dto: ShortlistCandidateDto,
  ) {
    return ok(
      await this.candidatesService.shortlistCandidate(
        sessionId,
        candidateItemId,
        dto ?? {},
      ),
    );
  }

  @Delete(':sessionId/cart/:candidateItemId')
  async removeFromSessionCart(
    @Param('sessionId') sessionId: string,
    @Param('candidateItemId') candidateItemId: string,
  ) {
    return ok(
      await this.candidatesService.removeFromSessionCart(
        sessionId,
        candidateItemId,
      ),
    );
  }
}
