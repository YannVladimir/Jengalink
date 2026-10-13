import { useI18n } from '@jengalink/i18n/react';
import { Text, useJengaTheme } from '@jengalink/ui/native';
import { router } from 'expo-router';
import { CircleAlert, CloudCheck, CloudOff, CloudUpload, FilePen } from 'lucide-react-native';
import { ActivityIndicator, Pressable } from 'react-native';
import { useOutbox } from '@/lib/outbox';

/**
 * The sync indicator (Phase 3): always visible in the header, honest about what has
 * not been sent yet. Tapping it opens the outbox.
 */
export function SyncStatus() {
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const { summary, syncing, online, ready } = useOutbox();
  if (!ready) return null;

  const tone =
    summary.failed > 0 ? status('problem') : summary.waiting > 0 ? status('waiting') : summary.drafts > 0 ? { color: colors.inkMuted } : status('paid');
  const label = syncing
    ? t('sync.sending')
    : summary.failed > 0
      ? t('sync.failed', { count: summary.failed })
      : summary.waiting > 0
        ? t(online ? 'sync.waiting' : 'sync.waitingOffline', { count: summary.waiting })
        : summary.drafts > 0
          ? t('sync.drafts', { count: summary.drafts })
          : t('sync.allSent');
  const Icon = summary.failed > 0 ? CircleAlert : summary.waiting > 0 ? (online ? CloudUpload : CloudOff) : summary.drafts > 0 ? FilePen : CloudCheck;

  return (
    <Pressable
      onPress={() => router.push('/outbox')}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${t('sync.title')}`}
      accessibilityLiveRegion="polite"
      hitSlop={8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}
    >
      {syncing ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon size={14} color={tone.color} />}
      <Text variant="caption" color={summary.failed > 0 || summary.waiting > 0 ? tone.color : colors.inkMuted}>
        {label}
      </Text>
    </Pressable>
  );
}
