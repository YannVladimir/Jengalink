import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { createDb, createPool } from './client';

export const DB = Symbol('DB');
export const DB_POOL = Symbol('DB_POOL');

@Global()
@Module({
  providers: [
    {
      provide: DB_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createPool(config.getOrThrow<string>('DATABASE_URL')),
    },
    {
      provide: DB,
      inject: [DB_POOL],
      useFactory: (pool: Pool) => createDb(pool),
    },
  ],
  exports: [DB, DB_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
