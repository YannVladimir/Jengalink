import { Injectable, Logger } from '@nestjs/common';
import type { OtpChannel } from '@jengalink/contracts';
import { maskEmail, maskPhone } from '../auth/contact';

/** Delivers a text message by SMS or email. One implementation per provider. */
export interface MessageSender {
  send(channel: OtpChannel, destination: string, text: string): Promise<void>;
}

export const MESSAGE_SENDER = Symbol('MESSAGE_SENDER');

interface SentMessage {
  channel: OtpChannel;
  destination: string;
  text: string;
}

/**
 * Development sender: prints messages (sign-in codes, invitations) to the API
 * console. Real SMS (Pindo, Africa's Talking) and email providers plug in behind
 * MessageSender once chosen. Keeps recent messages in memory for tests.
 */
@Injectable()
export class ConsoleMessageSender implements MessageSender {
  private readonly logger = new Logger('Message');
  readonly sent: SentMessage[] = [];

  send(channel: OtpChannel, destination: string, text: string): Promise<void> {
    this.sent.push({ channel, destination, text });
    if (this.sent.length > 100) this.sent.shift();
    const who =
      channel === 'sms' ? maskPhone(destination) : maskEmail(destination);
    // Development only: printed so you can sign in and accept invitations without a provider.
    this.logger.log(`${channel.toUpperCase()} to ${who}: ${text}`);
    return Promise.resolve();
  }

  lastTo(destination: string): SentMessage | undefined {
    return [...this.sent].reverse().find((m) => m.destination === destination);
  }

  lastCodeFor(destination: string): string | undefined {
    return [...this.sent]
      .reverse()
      .find((m) => m.destination === destination && /\d{6}/.test(m.text))
      ?.text.match(/(\d{6})/)?.[1];
  }
}
