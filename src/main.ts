import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { assertRuntimeConfig } from './common/config/runtime-config.guard';
import { setupAdminPanel } from './modules/admin/admin.bootstrap';
import { AppModule } from './app.module';

const session = require('express-session') as (options: {
  secret: string;
  resave: boolean;
  saveUninitialized: boolean;
  cookie: {
    httpOnly: boolean;
    secure: boolean;
  };
}) => unknown;

async function bootstrap() {
  assertRuntimeConfig();

  const app = await NestFactory.create(AppModule);

  const sessionSecret = process.env.ADMIN_SESSION_SECRET ?? 'dev-admin-session-secret';
  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: false,
      },
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await setupAdminPanel(app);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

bootstrap();
