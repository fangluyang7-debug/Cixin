import { Controller, Get, Param } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { SuggestionsService } from '../application/suggestions.service';

@Controller('api/v1/sessions')
export class SuggestionsController {
  constructor(private readonly suggestionsService: SuggestionsService) {}

  @Get(':sessionId/suggestions')
  async getSuggestions(@Param('sessionId') sessionId: string) {
    return ok(await this.suggestionsService.getSuggestions(sessionId));
  }
}
