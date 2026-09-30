import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common/pipes/validation.pipe';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  // Por defecto solo log/warn/error; LOG_DEBUG=true muestra también debug/verbose.
  const app = await NestFactory.create(AppModule, {
    logger:
      process.env.LOG_DEBUG === 'true'
        ? ['log', 'warn', 'error', 'fatal', 'debug', 'verbose']
        : ['log', 'warn', 'error', 'fatal'],
  });
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000, ()=>{
    console.log(`\n\nAplicafacil server running on port ${process.env.PORT ?? 3000} `);
  });
}
bootstrap();
