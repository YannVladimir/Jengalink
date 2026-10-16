import { spacing } from '@jengalink/ui';
import { Text } from '@jengalink/ui/native';
import { useI18n } from '@jengalink/i18n/react';
import { StatusBar } from 'expo-status-bar';
import { FlaskConical } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDemo } from '@/lib/environment';

const BANNER = '#7c2d12';

/**
 * In a demo environment, a strip above every screen (spec §34). It takes the status-bar area, so
 * the screens below are told there is no top inset left.
 */
export function DemoFrame({ children }: { children: ReactNode }) {
  const demo = useDemo();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  if (!demo) return children;
  return (
    <View style={{ flex: 1, backgroundColor: BANNER }}>
      <View
        accessibilityRole="text"
        style={{
          paddingTop: insets.top + 4,
          paddingBottom: 6,
          paddingHorizontal: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <FlaskConical size={14} color="#fff" />
        <Text variant="caption" color="#fff" numberOfLines={2} style={{ flexShrink: 1, textAlign: 'center', fontFamily: 'Inter_600SemiBold' }}>
          {t('demo.banner')}
        </Text>
      </View>
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaInsetsContext.Provider>
      <StatusBar style="light" />
    </View>
  );
}
