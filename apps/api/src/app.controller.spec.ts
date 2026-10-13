import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DB } from './db/database.module';
import { StorageService } from './storage/storage.service';

describe('AppController', () => {
  const setup = async (dbUp: boolean, storageUp: boolean) => {
    const execute = dbUp
      ? jest.fn().mockResolvedValue({})
      : jest.fn().mockRejectedValue(new Error('down'));
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: DB, useValue: { execute } },
        {
          provide: StorageService,
          useValue: { isHealthy: jest.fn().mockResolvedValue(storageUp) },
        },
      ],
    }).compile();
    return app.get<AppController>(AppController);
  };

  it('reports ok when the database and storage answer', async () => {
    const controller = await setup(true, true);
    await expect(controller.getHealth()).resolves.toMatchObject({
      status: 'ok',
      database: 'ok',
      storage: 'ok',
    });
  });

  it('reports degraded when the database is down', async () => {
    const controller = await setup(false, true);
    await expect(controller.getHealth()).resolves.toMatchObject({
      status: 'degraded',
      database: 'down',
    });
  });

  it('reports degraded when storage is down', async () => {
    const controller = await setup(true, false);
    await expect(controller.getHealth()).resolves.toMatchObject({
      status: 'degraded',
      storage: 'down',
    });
  });
});
