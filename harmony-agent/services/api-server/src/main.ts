import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  configureApp(app);

  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 3100;
  const host = config.get<string>('host') ?? '0.0.0.0';
  await app.listen(port, host);
}

void bootstrap();
