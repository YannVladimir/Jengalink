import { Injectable, Logger } from '@nestjs/common';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Opened by the app when the person taps the notification. */
  data: { path: string; notificationId: string };
}

/** Per message: delivered to the provider, or why not. `gone` = the token is dead (app removed). */
export type PushResult =
  { ok: true } | { ok: false; error: string; gone: boolean };

/** Sends pushes. One implementation per provider. */
export interface PushSender {
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** Development and tests: prints pushes and keeps the recent ones in memory. */
@Injectable()
export class ConsolePushSender implements PushSender {
  private readonly logger = new Logger('Push');
  readonly sent: PushMessage[] = [];
  /** Tests: tokens that behave like an uninstalled app. */
  readonly goneTokens = new Set<string>();

  send(messages: PushMessage[]): Promise<PushResult[]> {
    return Promise.resolve(
      messages.map((m) => {
        if (this.goneTokens.has(m.token))
          return { ok: false, error: 'DeviceNotRegistered', gone: true };
        this.sent.push(m);
        if (this.sent.length > 200) this.sent.shift();
        this.logger.log(
          `to …${m.token.slice(-6)}: ${m.title} — ${m.body} → ${m.data.path}`,
        );
        return { ok: true };
      }),
    );
  }
}

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/** Expo's push service (FCM and APNs behind it). Up to 100 messages per request. */
export class ExpoPushSender implements PushSender {
  constructor(private readonly accessToken?: string) {}

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const out: PushResult[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      try {
        const res = await fetch(EXPO_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(this.accessToken
              ? { authorization: `Bearer ${this.accessToken}` }
              : {}),
          },
          body: JSON.stringify(
            batch.map((m) => ({
              to: m.token,
              title: m.title,
              body: m.body,
              data: m.data,
              sound: 'default',
              priority: 'high',
              channelId: 'default',
            })),
          ),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
        const { data } = (await res.json()) as { data: ExpoTicket[] };
        for (const t of data)
          out.push(
            t.status === 'ok'
              ? { ok: true }
              : {
                  ok: false,
                  error: t.details?.error ?? t.message ?? 'error',
                  gone: t.details?.error === 'DeviceNotRegistered',
                },
          );
      } catch (err) {
        const error = (err as Error).message;
        out.push(
          ...batch.map(() => ({ ok: false as const, error, gone: false })),
        );
      }
    }
    return out;
  }
}
