import { DECISION_LATE_DAYS, type DecisionInbox, daysWaiting } from '@jengalink/contracts';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { Text, useJengaTheme } from '@jengalink/ui/native';
import { useI18n } from '@jengalink/i18n/react';
import { type Href, router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

const SHOWN = 4;

/**
 * The decision inbox on Home (spec §4.2, §5): what waits on me across my projects, oldest first,
 * with how long the oldest has waited. One tap opens the screen where it is decided.
 */
export function DecisionInboxCard({ inbox, now, multiProject }: { inbox: DecisionInbox; now: number; multiProject: boolean }) {
  const { t } = useI18n();
  const { colors } = useJengaTheme();
  const [all, setAll] = useState(false);
  const oldest = inbox.oldestSince ? daysWaiting(inbox.oldestSince, now) : 0;
  const late = oldest > DECISION_LATE_DAYS;
  const items = all ? inbox.items : inbox.items.slice(0, SHOWN);

  return (
    <View style={{ borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.primary, gap: spacing.sm }}>
      <View style={{ gap: 4 }}>
        <Text variant="sectionTitle" color={colors.onPrimary}>
          {t('home.decisions', { count: inbox.count })}
        </Text>
        <View
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 10,
            paddingVertical: 3,
            borderRadius: radius.pill,
            // Late: a white pill, the one thing that stands out on the orange card.
            backgroundColor: late ? colors.onPrimary : 'rgba(0,0,0,0.22)',
          }}
        >
          <Text variant="label" color={late ? colors.primary : colors.onPrimary}>
            {oldest < 1 ? t('inbox.oldestToday') : t('inbox.oldest', { count: oldest })}
          </Text>
        </View>
      </View>
      {items.map((d, i) => {
        const days = daysWaiting(d.since, now);
        return (
          <Pressable
            key={`${d.kind}-${d.path}-${i}`}
            onPress={() => router.push(d.path as Href)}
            accessibilityRole="button"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              minHeight: 52,
              paddingTop: spacing.sm,
              borderTopWidth: 1,
              borderTopColor: 'rgba(255,255,255,0.35)',
            }}
          >
            <View style={{ flex: 1, gap: 1 }}>
              <Text variant="label" color={colors.onPrimary}>
                {t(`inbox.kind_${d.kind}`)}
                {multiProject ? ` · ${d.projectName}` : ''}
              </Text>
              <Text variant="bodyStrong" color={colors.onPrimary} numberOfLines={1}>
                {d.title}
              </Text>
              <Text variant="caption" color={colors.onPrimary}>
                {d.amount !== null ? `${formatRwf(d.amount)} · ` : ''}
                {days < 1 ? t('inbox.waitingToday') : t('inbox.waiting', { count: days })}
              </Text>
            </View>
            <ChevronRight size={20} color={colors.onPrimary} />
          </Pressable>
        );
      })}
      {inbox.items.length > SHOWN && (
        <Pressable onPress={() => setAll((x) => !x)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text variant="label" color={colors.onPrimary}>
            {all ? t('inbox.showLess') : t('inbox.showAll', { count: inbox.count })}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
