import { nativeFontFamily } from '@jengalink/ui';
import { useJengaTheme } from '@jengalink/ui/native';
import { Redirect, Tabs } from 'expo-router';
import { Camera, Ellipsis, House, Wallet } from 'lucide-react-native';
import { useI18n } from '@jengalink/i18n/react';
import { request } from '@jengalink/contracts/client';
import { useEffect } from 'react';
import { api, useAuth } from '@/lib/auth';
import { setInboxCount, useInboxCount } from '@/lib/inbox-count';

// A0 pilot shell (spec §36.2): Home, Updates, Money, More. Big touch targets.
export default function TabLayout() {
  const { colors } = useJengaTheme();
  const { status, user, withRefresh } = useAuth();
  const { t } = useI18n();
  const deciding = useInboxCount();
  // The Home badge: what waits on me (Home refreshes it whenever it is shown).
  useEffect(() => {
    if (status !== 'signedIn') return;
    void withRefresh(() => request(() => api.GET('/v1/decisions')))
      .then((d) => setInboxCount(d.count))
      .catch(() => undefined);
  }, [status, withRefresh]);
  // Signed-out users go to sign-in; first-time users add their name first.
  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/sign-in" />;
  if (!user?.displayName) return <Redirect href="/welcome" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 68,
          paddingTop: 6,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { fontFamily: nativeFontFamily.body500, fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.home'),
          tabBarIcon: ({ color }) => <House size={24} color={color} />,
          tabBarBadge: deciding || undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, fontFamily: nativeFontFamily.body600, fontSize: 11 },
        }}
      />
      <Tabs.Screen
        name="updates"
        options={{ title: t('nav.updates'), tabBarIcon: ({ color }) => <Camera size={24} color={color} /> }}
      />
      <Tabs.Screen
        name="money"
        options={{ title: t('nav.money'), tabBarIcon: ({ color }) => <Wallet size={24} color={color} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: t('nav.more'), tabBarIcon: ({ color }) => <Ellipsis size={24} color={color} /> }}
      />
    </Tabs>
  );
}
