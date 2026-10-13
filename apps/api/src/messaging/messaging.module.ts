import { Global, Module } from '@nestjs/common';
import { ConsoleMessageSender, MESSAGE_SENDER } from './message-sender';

@Global()
@Module({
  providers: [
    ConsoleMessageSender,
    // SMS_PROVIDER / EMAIL_PROVIDER pick the sender; only 'console' exists until a provider is chosen.
    { provide: MESSAGE_SENDER, useExisting: ConsoleMessageSender },
  ],
  exports: [MESSAGE_SENDER, ConsoleMessageSender],
})
export class MessagingModule {}
