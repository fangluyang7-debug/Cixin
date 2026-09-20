import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserMemoryContextService } from '../application/user-memory-context.service';
import { UserMemoryService } from '../application/user-memory.service';
import {
  CreateUserProfileBlockDto,
  SaveShoeSizePreferenceDto,
  UpdateUserProfileBlockDto,
} from '../dto/user-memory.dto';

@Controller('api/v1/users/me')
@UseGuards(JwtAuthGuard)
export class UserMemoryController {
  constructor(
    private readonly userMemory: UserMemoryService,
    private readonly userMemoryContext: UserMemoryContextService,
  ) {}

  @Get('profile')
  async getProfile(@Req() request: AuthenticatedRequest) {
    return ok(await this.userMemory.getProfile(request.user!.userId));
  }

  @Get('profile/context')
  async getProfileContext(
    @Req() request: AuthenticatedRequest,
    @Query('category') category?: string,
  ) {
    return ok(await this.userMemoryContext.getContext(request.user!.userId, category ?? 'shoe'));
  }

  @Post('profile/blocks')
  async createBlock(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateUserProfileBlockDto,
  ) {
    return ok(await this.userMemory.createBlock(request.user!.userId, dto));
  }

  @Patch('profile/blocks/:blockId')
  async updateBlock(
    @Req() request: AuthenticatedRequest,
    @Param('blockId') blockId: string,
    @Body() dto: UpdateUserProfileBlockDto,
  ) {
    return ok(await this.userMemory.updateBlock(request.user!.userId, blockId, dto));
  }

  @Delete('profile/blocks/:blockId')
  async deleteBlock(@Req() request: AuthenticatedRequest, @Param('blockId') blockId: string) {
    return ok(await this.userMemory.deleteBlock(request.user!.userId, blockId));
  }

  @Get('memory-proposals')
  async listProposals(@Req() request: AuthenticatedRequest) {
    return ok(await this.userMemory.listProposals(request.user!.userId));
  }

  @Post('memory-proposals/:proposalId/confirm')
  async confirmProposal(
    @Req() request: AuthenticatedRequest,
    @Param('proposalId') proposalId: string,
  ) {
    return ok(await this.userMemory.confirmProposal(request.user!.userId, proposalId));
  }

  @Post('memory-proposals/:proposalId/reject')
  async rejectProposal(
    @Req() request: AuthenticatedRequest,
    @Param('proposalId') proposalId: string,
  ) {
    return ok(await this.userMemory.rejectProposal(request.user!.userId, proposalId));
  }
}

@Controller('api/v1/preferences')
export class LocalPreferencesController {
  constructor(private readonly userMemory: UserMemoryService) {}

  @Get('shoe-size')
  async getShoeSizePreference(@Query('deviceId') deviceId?: string) {
    return ok(await this.userMemory.getLocalShoeSizePreference(deviceId));
  }

  @Post('shoe-size')
  async saveShoeSizePreference(@Body() dto: SaveShoeSizePreferenceDto) {
    return ok(await this.userMemory.saveLocalShoeSizePreference(dto.deviceId, dto.shoeSize));
  }
}
