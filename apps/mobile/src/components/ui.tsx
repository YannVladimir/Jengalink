import type { DecisionView, SiteUpdateView } from '@jengalink/contracts';
import { radius, spacing, type Status } from '@jengalink/ui';
import { Money, StatusBadge, Text, useJengaTheme } from '@jengalink/ui/native';
import { router } from 'expo-router';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDuration, formatShortDate, formatUpdatedAgo, type MessageKey } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { project } from '@/lib/demo';
import { PhotoTile } from './PhotoTile';
import { SyncStatus } from './SyncStatus';

/** Tab screen shell: safe area, scroll, optional pinned main action. */
export function Screen({
  children,
  footer,
  scrollStyle,
}: {
  children: ReactNode;
  footer?: ReactNode;
  scrollStyle?: StyleProp<ViewStyle>;
}) {
  const { colors } = useJengaTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          { padding: spacing.lg, gap: spacing.lg, paddingBottom: footer ? 112 : spacing.xxl },
          scrollStyle,
        ]}
      >
        {children}
      </ScrollView>
      {footer && <BottomAction>{footer}</BottomAction>}
    </SafeAreaView>
  );
}

/** One main action per screen, pinned within thumb reach. */
export function BottomAction({ children }: { children: ReactNode }) {
  const { colors } = useJengaTheme();
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: spacing.lg,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      {children}
    </View>
  );
}

/** Project name (switches projects) with an honest freshness line. */
export function ProjectHeader({ title }: { title?: string }) {
  const { t, locale } = useI18n();
  const { colors } = useJengaTheme();
  return (
    <View style={{ gap: 2 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={project.name}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 44 }}
      >
        <Text variant="screenTitle">{title ?? project.name}</Text>
        {!title && <ChevronDown size={22} color={colors.inkMuted} />}
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Text variant="caption" muted>
          {title ? project.name + ' · ' : ''}
          {t('common.updated', { when: formatUpdatedAgo(t, locale, project.updatedAt) })} ·
        </Text>
        <SyncStatus />
      </View>
    </View>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { colors } = useJengaTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text variant="sectionTitle">{title}</Text>
      {action && (
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text variant="label" color={colors.primary}>
            {action}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Orange = needs you. One tap opens the oldest decision. */
export function DecisionCard({ decisions }: { decisions: DecisionView[] }) {
  const { t } = useI18n();
  const { colors } = useJengaTheme();
  if (decisions.length === 0) return null;
  const oldest = [...decisions].sort((a, b) => a.waitingSince.localeCompare(b.waitingSince))[0];
  const waited = t('common.waiting', { duration: formatDuration(t, oldest.waitingSince) });
  return (
    <Pressable
      onPress={() => router.push(oldest.href as never)}
      accessibilityRole="button"
      accessibilityLabel={`${t('home.decisions', { count: decisions.length })}. ${oldest.title}, ${waited}. ${t('home.review')}`}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.primaryPressed : colors.primary,
        borderRadius: radius.lg,
        padding: spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="sectionTitle" color={colors.onPrimary}>
          {t('home.decisions', { count: decisions.length })}
        </Text>
        <Text variant="label" color={colors.onPrimary}>
          {oldest.subtitle} · {waited}
        </Text>
      </View>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 16, minHeight: 44, paddingVertical: 6, justifyContent: 'center' }}>
        <Text variant="bodyStrong" color={colors.primary}>
          {t('home.review')}
        </Text>
      </View>
    </Pressable>
  );
}

export function ListRow({
  icon: Icon,
  title,
  subtitle,
  right,
  onPress,
  last,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const { colors } = useJengaTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 60,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.lg,
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      })}
    >
      {Icon && (
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.structureSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} color={colors.structure} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text variant="caption" muted numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
      {onPress && <ChevronRight size={18} color={colors.inkSubtle} />}
    </Pressable>
  );
}

const updateStatus: Record<SiteUpdateView['status'], Status> = {
  reported: 'reported',
  accepted: 'paid',
  problem: 'problem',
};
const updateLabel: Record<SiteUpdateView['status'], MessageKey> = {
  reported: 'status.reported',
  accepted: 'status.accepted',
  problem: 'status.blocker',
};

/** A site update: photos first (proof), then the note. */
export function UpdateCard({ update }: { update: SiteUpdateView }) {
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
      }}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, padding: 4 }}>
        {update.photos.map((p) => (
          <PhotoTile key={p.id} photo={p} width={update.photos.length === 1 ? 320 : 220} height={150} />
        ))}
      </ScrollView>
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
          <Text variant="label" muted style={{ flexShrink: 1 }}>
            {update.stageName} · {formatShortDate(locale, update.createdAt)}
          </Text>
          <StatusBadge status={updateStatus[update.status]} label={t(updateLabel[update.status])} />
        </View>
        <Text>{update.note}</Text>
        {update.blockers && (
          <Text variant="label" color={status('problem').color}>
            {t('updates.blocker', { text: update.blockers })}
          </Text>
        )}
        <Text variant="caption" muted>
          {t('updates.by', { author: update.author, when: formatUpdatedAgo(t, locale, update.createdAt) })}
        </Text>
      </View>
    </View>
  );
}

export function AmountLine({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }}>
      <Text variant={strong ? 'bodyStrong' : 'body'} muted={!strong}>
        {label}
      </Text>
      <Money amount={amount} />
    </View>
  );
}
