import { Socket } from 'node:net';

export interface ScanResult {
  clean: boolean;
  /** The signature that matched, e.g. "Win.Test.EICAR_HDB-1". */
  signature?: string;
  /** Which engine judged the file, stored with the result. */
  engine: string;
}

/** Scans uploaded files before anyone else can open them (spec §16.2). */
export abstract class MediaScanner {
  abstract scan(file: Buffer): Promise<ScanResult>;
}

/** The industry-standard harmless test file, assembled at run time so this source file is not itself flagged. */
const EICAR = Buffer.from(
  'WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=',
  'base64',
);

/**
 * Development and tests only: recognises the EICAR test file and nothing else.
 * Production refuses to start without ClamAV (see config/env.ts).
 */
export class BasicScanner extends MediaScanner {
  scan(file: Buffer): Promise<ScanResult> {
    const infected = file.includes(EICAR);
    return Promise.resolve({
      clean: !infected,
      signature: infected ? 'EICAR-Test-File' : undefined,
      engine: 'basic (development only)',
    });
  }
}

/**
 * ClamAV over clamd's INSTREAM protocol: the file is streamed in chunks, each
 * prefixed with its 4-byte length, then a zero-length chunk ends it.
 */
export class ClamavScanner extends MediaScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 30_000,
  ) {
    super();
  }

  async scan(file: Buffer): Promise<ScanResult> {
    const reply = await this.command('zINSTREAM\0', file);
    const engine = await this.version().catch(() => 'clamav');
    // "stream: OK" or "stream: Win.Test.EICAR_HDB-1 FOUND"
    const found = /stream: (.+) FOUND/.exec(reply);
    if (found) return { clean: false, signature: found[1], engine };
    if (/stream: OK/.test(reply)) return { clean: true, engine };
    throw new Error(`ClamAV could not scan the file: ${reply.trim()}`);
  }

  version(): Promise<string> {
    return this.command('zVERSION\0').then((v) => v.replace(/\0/g, '').trim());
  }

  private command(cmd: string, body?: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      socket.setTimeout(this.timeoutMs, () =>
        socket.destroy(new Error('ClamAV timed out')),
      );
      socket.on('data', (d: Buffer) => chunks.push(d));
      socket.on('error', reject);
      socket.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
      socket.connect(this.port, this.host, () => {
        socket.write(cmd);
        if (body) {
          const size = 64 * 1024;
          for (let i = 0; i < body.length; i += size) {
            const part = body.subarray(i, i + size);
            const len = Buffer.alloc(4);
            len.writeUInt32BE(part.length);
            socket.write(len);
            socket.write(part);
          }
          socket.write(Buffer.alloc(4));
        }
      });
    });
  }
}
