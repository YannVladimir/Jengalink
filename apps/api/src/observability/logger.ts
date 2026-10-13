import { Injectable, type LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requestContext } from '../common/request-context';
import { redact, redactValue } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogLine {
  level: LogLevel;
  time: string;
  msg: string;
  context?: string;
  requestId?: string;
  [field: string]: unknown;
}

/**
 * Structured logs: one JSON object per line in staging/production (searchable,
 * tied to the request id users quote), readable lines in development.
 * Every message and field is redacted first.
 */
@Injectable()
export class JengaLogger implements LoggerService {
  private readonly level: LogLevel;
  private readonly json: boolean;

  /** Where lines go; tests replace it. */
  write: (line: string) => void = (l) => process.stdout.write(l + '\n');

  constructor(config: ConfigService) {
    this.level = config.get<LogLevel>('LOG_LEVEL') ?? 'info';
    this.json = config.get<string>('LOG_FORMAT') === 'json';
  }

  /** Structured entry with extra fields: logger.event('info', 'request', { status: 200 }). */
  event(
    level: LogLevel,
    msg: string,
    fields: Record<string, unknown> = {},
    context?: string,
  ) {
    if (ORDER[level] < ORDER[this.level]) return;
    const line: LogLine = {
      level,
      time: new Date().toISOString(),
      msg: redact(msg),
      ...(context ? { context } : {}),
      ...(requestContext()?.requestId
        ? { requestId: requestContext()!.requestId }
        : {}),
      ...(redactValue(fields) as Record<string, unknown>),
    };
    this.write(this.json ? JSON.stringify(line) : this.pretty(line));
  }

  log(message: unknown, context?: string) {
    this.event('info', this.text(message), {}, context);
  }
  error(message: unknown, stackOrContext?: string, context?: string) {
    // Nest calls error(message, stack, context) or error(message, context).
    const hasStack =
      typeof stackOrContext === 'string' && stackOrContext.includes('\n');
    this.event(
      'error',
      this.text(message),
      hasStack ? { stack: stackOrContext } : {},
      hasStack ? context : (stackOrContext ?? context),
    );
  }
  warn(message: unknown, context?: string) {
    this.event('warn', this.text(message), {}, context);
  }
  debug(message: unknown, context?: string) {
    this.event('debug', this.text(message), {}, context);
  }
  verbose(message: unknown, context?: string) {
    this.event('debug', this.text(message), {}, context);
  }

  private text(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message instanceof Error) return message.message;
    return JSON.stringify(redactValue(message));
  }

  private pretty(l: LogLine): string {
    const { level, time, msg, context, requestId, ...rest } = l;
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    return `${time.slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${context ? `[${context}] ` : ''}${msg}${requestId ? ` (req ${requestId.slice(0, 8)})` : ''}${extra}`;
  }
}
