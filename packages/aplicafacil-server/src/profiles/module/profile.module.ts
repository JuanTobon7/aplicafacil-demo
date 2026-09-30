import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfileModel } from '../models/profiles.model';
import { ProfileController } from '../controller/profile.controller';
import { ProfileService } from '../service/contract/profile.service';
import { ProfileServiceImpl } from '../service/impl/profile.impl.service';
import { SkillsModel } from '../models/skills.model';
import { ExperiencesModel } from '../models/experiences.model';
import { EducationModel } from '../models/education.model';
import { ProjectModel } from '../models/projects.model';
import { PeopleModule } from 'src/people/module/people.module';
import { CvsModel } from '../models/cvs.model';
import { ProfileCvServiceImpl } from '../service/impl/profile.cv.impl.service';
import { ProfileCvService } from '../service/contract/profile.cv.service';
import { StorageModule } from 'src/components/storage.media/module/storage.module';
import { McpClientModule } from 'src/mcp-client';
import { AiModule } from 'src/ai/module/ai.module';
import { NestLoggerAdapter } from 'src/common/logger/nest-logger.adapter';
import {
  ExtractCvUseCase,
  AI_COMPLETION_PORT,
  LOGGER_PORT,
  type AiCompletionPort,
  type LoggerPort,
} from '@aplicafacil/core/application';

@Module({
  imports: [
    PeopleModule,
    McpClientModule,
    StorageModule,
    AiModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forFeature([
      ProfileModel,
      SkillsModel,
      ExperiencesModel,
      EducationModel,
      CvsModel,
      ProjectModel,
    ]),
  ],
  controllers: [ProfileController],
  providers: [
    {
      provide: ProfileService,
      useClass: ProfileServiceImpl,
    },
    {
      provide: ProfileCvService,
      useClass: ProfileCvServiceImpl,
    },
    {
      provide: ExtractCvUseCase,
      inject: [AI_COMPLETION_PORT, LOGGER_PORT],
      useFactory: (ai: AiCompletionPort, logger: LoggerPort) =>
        new ExtractCvUseCase(ai, logger),
    },
    {
      provide: LOGGER_PORT,
      useFactory: () => new NestLoggerAdapter('ExtractCvUseCase'),
    },
  ],
  exports: [ProfileService],
})
export class ProfileModule {}
