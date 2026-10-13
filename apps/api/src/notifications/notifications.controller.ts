import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  NotificationList,
  NotificationSettings,
  UpdateNotificationSettings,
  NotificationView,
  RegisterPushDeviceRequest,
  RemovePushDeviceRequest,
} from '@jengalink/contracts';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { Contract } from '../common/contract';
import { NotificationsService } from './notifications.service';

const uuid = new ParseUUIDPipe({ version: '7' });

@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @Contract({
    tag: 'Notifications',
    summary:
      'Your latest notifications, in your language, with the unread count',
    response: NotificationList,
  })
  list(@CurrentUser() auth: AuthUser): Promise<NotificationList> {
    return this.notifications.list(auth.userId);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  @Contract({
    tag: 'Notifications',
    summary: 'Mark all your notifications read',
    response: NotificationList,
  })
  readAll(@CurrentUser() auth: AuthUser): Promise<NotificationList> {
    return this.notifications.markAllRead(auth.userId);
  }

  @Post('notifications/:notificationId/read')
  @HttpCode(200)
  @Contract({
    tag: 'Notifications',
    summary: 'Mark one notification read (opening it does this)',
    response: NotificationView,
  })
  read(
    @CurrentUser() auth: AuthUser,
    @Param('notificationId', uuid) notificationId: string,
  ): Promise<NotificationView> {
    return this.notifications.markRead(auth.userId, notificationId);
  }

  @Post('me/push-devices')
  @HttpCode(204)
  @Contract({
    tag: 'Notifications',
    summary: "Register this phone's push token for your account",
    body: RegisterPushDeviceRequest,
  })
  register(
    @CurrentUser() auth: AuthUser,
    @Body() body: unknown,
  ): Promise<void> {
    return this.notifications.registerDevice(auth.userId, body);
  }

  @Post('me/push-devices/remove')
  @HttpCode(204)
  @Contract({
    tag: 'Notifications',
    summary: 'Stop pushes to this phone (on sign-out)',
    body: RemovePushDeviceRequest,
  })
  remove(@CurrentUser() auth: AuthUser, @Body() body: unknown): Promise<void> {
    return this.notifications.removeDevice(auth.userId, body);
  }

  @Get('me/notification-settings')
  @Contract({
    tag: 'Notifications',
    summary: 'Your reminders and quiet hours',
    response: NotificationSettings,
  })
  getSettings(@CurrentUser() auth: AuthUser): Promise<NotificationSettings> {
    return this.notifications.settings(auth.userId);
  }

  @Put('me/notification-settings')
  @Contract({
    tag: 'Notifications',
    summary:
      'Turn the daily reminder on or off and set quiet hours (null = pushes any time)',
    body: UpdateNotificationSettings,
    response: NotificationSettings,
  })
  putSettings(
    @CurrentUser() auth: AuthUser,
    @Body() body: unknown,
  ): Promise<NotificationSettings> {
    return this.notifications.updateSettings(auth.userId, body);
  }
}
