import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DecisionsModule } from '../decisions/decisions.module';
import { NotificationsController } from './notifications.controller';
import { ReminderScheduler } from './reminder-scheduler';
import { NotificationsService } from './notifications.service';
import { ConsolePushSender, ExpoPushSender, PUSH_SENDER } from './push-sender';

@Module({
  imports: [DecisionsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    ReminderScheduler,
    ConsolePushSender,
    {
      // PUSH_PROVIDER: 'console' prints pushes (development, tests); 'expo' sends through Expo.
      provide: PUSH_SENDER,
      inject: [ConfigService, ConsolePushSender],
      useFactory: (config: ConfigService, console: ConsolePushSender) =>
        config.get<string>('PUSH_PROVIDER') === 'expo'
          ? new ExpoPushSender(
              config.get<string>('EXPO_ACCESS_TOKEN') || undefined,
            )
          : console,
    },
  ],
  exports: [ConsolePushSender, NotificationsService, ReminderScheduler],
})
export class NotificationsModule {}
