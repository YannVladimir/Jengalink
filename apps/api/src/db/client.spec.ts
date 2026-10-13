import { Logger } from '@nestjs/common';
import { createPool } from './client';

describe('database pool', () => {
  it('survives a dropped idle connection instead of crashing the API', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const pool = createPool('postgres://nobody:nothing@127.0.0.1:1/none');
    // Node throws on an 'error' event nobody listens to; the pool must have a listener.
    expect(() =>
      pool.emit('error', new Error('read ECONNRESET')),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith('Idle connection lost: read ECONNRESET');
    await pool.end();
    warn.mockRestore();
  });
});
