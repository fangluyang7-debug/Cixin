import { ServerResponse } from 'node:http';
import { BadRequestException, Body, Controller, Headers, Post, Res } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { AuthService } from '../../auth/application/auth.service';
import { ShoppingRuntimeService } from '../application/shopping-runtime.service';

@Controller('api/v1/shopping')
export class ShoppingTaskController {
  constructor(private readonly runtime: ShoppingRuntimeService, private readonly auth: AuthService) {}

  @Post('tasks')
  async submit(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) response: ServerResponse, @Headers('authorization') authorization?: string) {
    const operations: Record<string, string> = { text: 'shopping.text', image: 'shopping.image',
      image_upload: 'shopping.image_upload', prices: 'shopping.prices', answer: 'shopping.answer', read: 'shopping.read', refine: 'shopping.refine' };
    const operation = typeof body.operation === 'string' ? operations[body.operation] : undefined;
    if (!operation || typeof body.taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.taskId)) {
      throw new BadRequestException('SHOPPING_TASK_INVALID');
    }
    if (!body.taskProfile || !body.deviceProfile) throw new BadRequestException('SHOPPING_PROFILE_REQUIRED');
    const user = await this.auth.getUserFromAuthorization(authorization);
    const controller = new AbortController();
    const disconnected = () => { if (!response.writableEnded) controller.abort(); };
    response.on('close', disconnected);
    try {
    return ok(await this.runtime.execute(operation, { dto: body.input,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
      userId: user?.userId ?? null, taskId: body.taskId,
      taskProfile: body.taskProfile, deviceProfile: body.deviceProfile, networkProfile: body.networkProfile }, controller.signal));
    } finally { response.off('close', disconnected); }
  }
}
