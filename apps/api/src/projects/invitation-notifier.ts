import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import {
  MESSAGE_SENDER,
  type MessageSender,
} from '../messaging/message-sender';
import { InvitationsService } from './invitations.service';

/**
 * Sends the invitation SMS or email from the outbox, so a slow or failing
 * provider never blocks or rolls back the invitation itself (spec §16.2).
 * A withdrawn invitation is skipped.
 */
@Injectable()
export class InvitationNotifier implements OnModuleInit {
  static readonly consumer = 'notify-invitee';

  constructor(
    private readonly jobs: JobsService,
    private readonly invitations: InvitationsService,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
  ) {}

  onModuleInit() {
    this.jobs.on(
      'invitation.created',
      InvitationNotifier.consumer,
      async ({ invitationId }, tx) => {
        const message = await this.invitations.messageFor(tx, invitationId);
        if (message)
          await this.sender.send(
            message.channel,
            message.recipient,
            message.text,
          );
      },
    );
  }
}
