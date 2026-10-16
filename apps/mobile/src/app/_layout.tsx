import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { nativeFontFamily } from '@jengalink/ui';
import { useJengaTheme } from '@jengalink/ui/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useI18n } from '@jengalink/i18n/react';
import { DemoFrame } from '@/components/DemoFrame';
import { AuthProvider } from '@/lib/auth';
import { LocaleRoot } from '@/lib/locale';
import { CurrentProjectProvider } from '@/lib/current-project';
import { OutboxProvider } from '@/lib/outbox';
import { PushBridge } from '@/lib/push';
import { RoleProvider } from '@/lib/role';

// Only these 5 weights are loaded, to keep the app small (Build Plan: Fonts).
const fontMap = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts(fontMap);
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <LocaleRoot>
          <OutboxProvider>
            <CurrentProjectProvider>
              <RoleProvider>
                <DemoFrame>
                  <RootStack />
                </DemoFrame>
                <PushBridge />
              </RoleProvider>
            </CurrentProjectProvider>
          </OutboxProvider>
        </LocaleRoot>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/** Screen titles follow the chosen language. */
function RootStack() {
  const { colors, dark } = useJengaTheme();
  const { t } = useI18n();
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: nativeFontFamily.heading600, fontSize: 17 },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in/index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in/code" options={{ title: '' }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="claim/[id]" options={{ title: t('nav.paymentClaim') }} />
        <Stack.Screen name="stage/[id]" options={{ title: t('nav.stage') }} />
        <Stack.Screen name="update/new" options={{ title: t('nav.newUpdate'), presentation: 'modal' }} />
        <Stack.Screen name="project/new" options={{ title: t('wizard.title'), presentation: 'modal' }} />
        <Stack.Screen name="project/[id]/invite" options={{ title: t('invite.inviteOwner') }} />
        <Stack.Screen name="project/[id]/plan" options={{ title: t('plan.title') }} />
        <Stack.Screen name="project/[id]/accept" options={{ title: t('accept.title') }} />
        <Stack.Screen name="invitations/index" options={{ title: t('invite.listTitle') }} />
        <Stack.Screen name="invitations/[id]" options={{ title: t('invite.receivedTitle') }} />
        <Stack.Screen name="invite/[token]" options={{ title: t('invite.receivedTitle') }} />
        <Stack.Screen name="design" options={{ title: t('nav.designSystem') }} />
        <Stack.Screen name="outbox" options={{ title: t('sync.title') }} />
        <Stack.Screen name="notifications" options={{ title: t('notify.screenTitle') }} />
        <Stack.Screen name="projects" options={{ title: t('plan.projectsTitle') }} />
        <Stack.Screen name="project/[id]/quotes/index" options={{ title: t('quote.title') }} />
        <Stack.Screen name="project/[id]/quotes/[quoteId]" options={{ title: t('quote.title') }} />
        <Stack.Screen name="project/[id]/claims/index" options={{ title: t('claims.title') }} />
        <Stack.Screen name="project/[id]/claims/[claimId]" options={{ title: t('claims.title') }} />
        <Stack.Screen name="project/[id]/spending/index" options={{ title: t('spending.title') }} />
        <Stack.Screen name="project/[id]/payments" options={{ title: t('payments.title') }} />
        <Stack.Screen name="project/[id]/changes/index" options={{ title: t('changes.title') }} />
        <Stack.Screen name="project/[id]/changes/[changeId]" options={{ title: t('changes.title') }} />
        <Stack.Screen name="project/[id]/reports/index" options={{ title: t('report.list') }} />
        <Stack.Screen name="project/[id]/reports/[reportId]" options={{ title: t('report.title') }} />
        <Stack.Screen name="project/[id]/reports/share" options={{ title: t('share.title') }} />
        <Stack.Screen name="project/[id]/exports" options={{ title: t('exports.title') }} />
        <Stack.Screen name="project/[id]/spending/[requestId]" options={{ title: t('spending.title') }} />
        <Stack.Screen name="project/[id]/stages/[stageId]" options={{ title: t('feed.stageTimeline') }} />
      </Stack>
    </>
  );
}
