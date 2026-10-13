import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaProcessor } from '../media/media-processor';
import { BasicScanner, ClamavScanner, MediaScanner } from '../media/scanner';
import { ProjectsModule } from '../projects/projects.module';
import {
  OverviewController,
  SiteUpdatesController,
} from './site-updates.controller';
import { SiteUpdatesService } from './site-updates.service';

@Module({
  imports: [ProjectsModule],
  controllers: [SiteUpdatesController, OverviewController],
  providers: [
    SiteUpdatesService,
    MediaProcessor,
    {
      // ClamAV when configured; the EICAR-only check otherwise (refused in production by config/env.ts).
      provide: MediaScanner,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('CLAMAV_HOST');
        return host
          ? new ClamavScanner(host, config.get<number>('CLAMAV_PORT') ?? 3310)
          : new BasicScanner();
      },
    },
  ],
  exports: [SiteUpdatesService],
})
export class SiteUpdatesModule {}
