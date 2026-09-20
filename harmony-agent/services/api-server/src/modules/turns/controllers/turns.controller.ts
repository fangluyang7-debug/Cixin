import { Body, Controller, Param, Post } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { TurnsService } from '../application/turns.service';
import { CreateTurnDto } from '../dto/create-turn.dto';

@Controller('api/v1/sessions')
export class TurnsController {
  constructor(private readonly turnsService: TurnsService) {}

  @Post(':sessionId/turns')
  async createTurn(@Param('sessionId') sessionId: string, @Body() dto: CreateTurnDto) {
    return ok(await this.turnsService.createTurn(sessionId, dto));
  }
}
