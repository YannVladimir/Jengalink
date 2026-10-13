import { request } from '@jengalink/contracts/client';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { type Href, router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { api, pushTokenStore, useAuth } from '@/lib/auth';

// Show pushes that arrive while the app is open too.
if (Platform.OS !== 'web')
  Notifications.setNotificationHandler({
    handleNotification: () => Promise.resolve({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
  });

/**
 * This phone's Expo push token, after asking permission. Null on the web build, when permission is
 * refused, or before the app has an EAS project id (push needs a development or store build).
 */
async function pushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'JengaLink', importance: Notifications.AndroidImportance.HIGH });
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

/** Opens the exact item of a notification and marks it read (also used by the Notifications list). */
export function openNotification(withRefresh: ReturnType<typeof useAuth>['withRefresh'], n: { id: string; path: string }) {
  void withRefresh(() => request(() => api.POST('/v1/notifications/{notificationId}/read', { params: { path: { notificationId: n.id } } }))).catch(() => undefined);
  router.push(n.path as Href);
}

/** Registers this phone for pushes once signed in, and opens the item when a push is tapped. */
export function PushBridge() {
  if (Platform.OS === 'web') return null;
  return <NativePushBridge />;
}

function NativePushBridge() {
  const { status, withRefresh } = useAuth();
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'signedIn') return;
    void pushToken()
      .then(async (token) => {
        if (!token) return;
        await withRefresh(() => request(() => api.POST('/v1/me/push-devices', { body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } })));
        await pushTokenStore.set(token);
      })
      .catch(() => undefined); // no push is never a reason to block the app
  }, [status, withRefresh]);

  useEffect(() => {
    if (status !== 'signedIn' || !last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const data = last.notification.request.content.data as { path?: string; notificationId?: string } | undefined;
    const id = last.notification.request.identifier;
    if (!data?.path || !data.notificationId || handled.current === id) return;
    handled.current = id;
    openNotification(withRefresh, { id: data.notificationId, path: data.path });
  }, [last, status, withRefresh]);

  return null;
}
