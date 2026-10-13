import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { spacing } from '@jengalink/ui';
import { Button, Card, Text, useJengaTheme } from '@jengalink/ui/native';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SyncStatus } from '@/components/SyncStatus';
import { useOutbox } from '@/lib/outbox';
import type { OutboxItem } from '@/lib/outbox-core';

/** Everything written on this phone that has not reached the server yet. */
export default function OutboxScreen() {
  const { t } = useI18n();
  const { colors } = useJengaTheme();
  const { items, syncNow, syncing, summary } = useOutbox();
  const drafts = items.filter((i) => i.status === 'draft');
  const waiting = items.filter((i) => i.status === 'queued');
  const failed = items.filter((i) => i.status === 'failed');

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
      <View style={{ gap: spacing.xs }}>
        <SyncStatus />
        <Text muted>{t('sync.lead')}</Text>
      </View>
      {items.length === 0 && <Text muted>{t('sync.empty')}</Text>}
      {summary.waiting > 0 && (
        <View style={{ alignSelf: 'flex-start' }}>
          <Button title={t('sync.sendNow')} variant="secondary" loading={syncing} onPress={() => void syncNow()} />
        </View>
      )}
      <Group title={t('sync.failedTitle')} items={failed} />
      <Group title={t('sync.waitingTitle')} items={waiting} />
      <Group title={t('sync.draftsTitle')} items={drafts} />
    </ScrollView>
  );
}

function Group({ title, items }: { title: string; items: OutboxItem[] }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="sectionTitle">{title}</Text>
      {items.map((i) => (
        <Entry key={i.id} item={i} />
      ))}
    </View>
  );
}

function Entry({ item }: { item: OutboxItem }) {
  const { t, locale } = useI18n();
  const { status } = useJengaTheme();
  const { removeItem, submit } = useOutbox();
  const [sending, setSending] = useState(false);
  const [armed, setArmed] = useState(false);
  const editable = item.status !== 'queued';
  return (
    <Card>
      <Text variant="bodyStrong">
        {item.projectName}
        {item.stageName ? ` · ${item.stageName}` : ''}
      </Text>
      {item.note ? (
        <Text numberOfLines={2} style={{ marginTop: 2 }}>
          {item.note}
        </Text>
      ) : null}
      <Text variant="caption" muted style={{ marginTop: 4 }}>
        {t('sync.writtenOn', { date: formatDate(locale, item.createdAt) })} · {t('sync.photosCount', { count: item.photos.length })}
      </Text>
      {item.status === 'failed' && (
        <View style={{ marginTop: 4, gap: 2 }}>
          {/* Why it stopped, in the reader's language; the server's own words below for support. */}
          <Text variant="caption" color={status('problem').color}>
            {t(`sync.failure_${item.failure ?? 'rejected'}`)}
          </Text>
          {item.lastError ? (
            <Text variant="caption" muted>
              {item.lastError}
            </Text>
          ) : null}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        {editable && (
          <Button
            title={item.status === 'draft' ? t('sync.continueDraft') : t('sync.edit')}
            variant="secondary"
            onPress={() => router.push({ pathname: '/update/new', params: { draftId: item.id } })}
          />
        )}
        {/* A conflict may clear (the project resumes): try again as it is. */}
        {item.status === 'failed' && item.failure === 'conflict' && (
          <Button
            title={t('sync.sendAgain')}
            loading={sending}
            onPress={() => {
              setSending(true);
              void submit(item.id).finally(() => setSending(false));
            }}
          />
        )}
        {editable && <Button title={armed ? t('sync.confirmDelete') : t('sync.delete')} variant={armed ? 'danger' : 'ghost'} onPress={() => (armed ? removeItem(item.id) : setArmed(true))} />}
      </View>
    </Card>
  );
}
