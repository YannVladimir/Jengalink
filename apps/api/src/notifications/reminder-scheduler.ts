import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DecisionsService } from '../decisions/decisions.service';
import { NotificationsService } from './notifications.service';

const EVERY_MS = 10 * 60_000;

/** Runs the reminder sweep every 10 minutes in processes that run jobs (JOBS_ENABLED). */
@Injectable()
export class ReminderScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ReminderScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly decisions: DecisionsService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.get<boolean>('JOBS_ENABLED')) return;
    const tick = () =>
      void this.run().catch((err: Error) =>
        this.logger.error('Reminder sweep failed', err),
      );
    this.timer = setInterval(tick, EVERY_MS);
    setTimeout(tick, 30_000).unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** One sweep now (also used by tests). */
  async run() {
    if (this.running) return { released: 0, reminded: 0 };
    this.running = true;
    try {
      const r = await this.notifications.sweep((userId) =>
        this.decisions.inbox(userId),
      );
      if (r.released || r.reminded)
        this.logger.log(
          `Reminders: ${r.reminded} sent, ${r.released} released after quiet hours`,
        );
      return r;
    } finally {
      this.running = false;
    }
  }
}
