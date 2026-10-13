import { Inject, Injectable } from '@nestjs/common';
import type { HealthResponse } from '@jengalink/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from './db/client';
import { DB } from './db/database.module';
import { StorageService } from './storage/storage.service';

@Injectable()
export class AppService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  async getHealth(): Promise<HealthResponse> {
    let database: HealthResponse['database'] = 'ok';
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      database = 'down';
    }
    const storage = (await this.storage.isHealthy()) ? 'ok' : 'down';
    return {
      status: database === 'ok' && storage === 'ok' ? 'ok' : 'degraded',
      service: 'jengalink-api',
      database,
      storage,
      time: new Date().toISOString(),
    };
  }
}
