import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';

export function configureApp(app: NestExpressApplication) {
  const config = app.get(ConfigService);
  const jsonBodyLimit = config.get<string>('jsonBodyLimit') ?? '10mb';

  app.useBodyParser('json', { limit: jsonBodyLimit });
  app.useBodyParser('urlencoded', { extended: true, limit: jsonBodyLimit });
  const corsOrigins = config.get<string[]>('corsOrigins') ?? [];
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: false,
  });
  app.useGlobalFilters(new ApiExceptionFilter());
}
