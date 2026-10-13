import { photoTime, type SiteUpdate, type UpdatePhoto } from '@jengalink/contracts';
import { formatDate, formatDateTime, formatUpdatedAgo, type MessageKey } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Card, Text, useJengaTheme } from '@jengalink/ui/native';
import { ChevronLeft, ChevronRight, ChevronsLeftRight, ImageOff, Loader, ShieldAlert, TriangleAlert, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { type GestureResponderEvent, Image, Linking, Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fromIsoDate } from './DatePickerSheet';

/** "Taken 3 Nov, 09:15 (camera clock)" — capture time with where it came from. */
export function takenLine(p: UpdatePhoto, t: ReturnType<typeof useI18n>['t'], locale: ReturnType<typeof useI18n>['locale']) {
  if (!p.capturedAt) return t('feed.takenUnknown');
  const time = formatDateTime(locale, p.capturedAt);
  return t(p.capturedAtSource === 'exif' ? 'feed.takenExif' : p.capturedAtSource === 'device' ? 'feed.takenDevice' : 'feed.taken', { time });
}

/** One photo tile: the thumbnail when ready, otherwise an honest placeholder. */
export function PhotoThumb({ photo, size, onPress }: { photo: UpdatePhoto; size: number; onPress?: () => void }) {
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const box = { width: size, height: size, borderRadius: radius.md, backgroundColor: colors.surfaceSunken } as const;
  if (photo.status === 'ready' && photo.thumbUrl)
    return (
      <Pressable onPress={onPress} accessibilityRole="imagebutton" accessibilityLabel={t('feed.openOriginal')}>
        <Image source={{ uri: photo.thumbUrl }} style={box} accessibilityIgnoresInvertColors />
      </Pressable>
    );
  const [Icon, label, color] =
    photo.status === 'processing'
      ? [Loader, t('feed.photoProcessing'), colors.inkMuted]
      : photo.status === 'blocked'
        ? [ShieldAlert, t('feed.photoBlocked'), status('problem').color]
        : [ImageOff, t('feed.photoFailed'), colors.inkMuted];
  return (
    <View accessible accessibilityLabel={label} style={{ ...box, alignItems: 'center', justifyContent: 'center', padding: 6, gap: 4 }}>
      <Icon size={20} color={color} />
      <Text variant="caption" color={color} style={{ textAlign: 'center', fontSize: 11, lineHeight: 14 }} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

/** A site update in the feed: who, when, which stage, note, blocker, photos. */
export function FeedCard({ update: u, onStage }: { update: SiteUpdate; onStage?: () => void }) {
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const [viewing, setViewing] = useState<number | null>(null);
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
        <Text variant="bodyStrong">{u.authorName ?? t('invite.someone')}</Text>
        <Text variant="caption" muted>
          {t('feed.sentAgo', { when: formatUpdatedAgo(t, locale, u.submittedAt) })}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6, flexWrap: 'wrap' }}>
        <Pressable
          onPress={onStage}
          disabled={!onStage}
          accessibilityRole="button"
          accessibilityHint={t('feed.viewStage')}
          style={{ paddingHorizontal: 10, minHeight: 28, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.structureSoft }}
        >
          <Text variant="caption" color={colors.structure}>
            {u.stageName}
          </Text>
        </Pressable>
        <Text variant="caption" muted>
          {t('feed.workOn', { date: formatDate(locale, fromIsoDate(u.eventDate)) })}
        </Text>
      </View>
      {u.note ? <Text style={{ marginTop: spacing.sm }}>{u.note}</Text> : null}
      {u.blockers ? (
        <View style={{ flexDirection: 'row', gap: 6, marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: status('problem').soft }}>
          <TriangleAlert size={16} color={status('problem').color} style={{ marginTop: 2 }} />
          <Text color={status('problem').color} style={{ flex: 1 }}>
            {t('feed.blocker', { text: u.blockers })}
          </Text>
        </View>
      ) : null}
      {u.photos.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
          {u.photos.map((p, i) => (
            <PhotoThumb key={p.id} photo={p} size={u.photos.length === 1 ? 220 : 100} onPress={() => setViewing(i)} />
          ))}
        </View>
      )}
      <PhotoViewer photos={u.photos} index={viewing} onIndex={setViewing} />
    </Card>
  );
}

/** Full-screen photo with its capture and upload times; next/previous for several. */
export function PhotoViewer({ photos, index, onIndex }: { photos: UpdatePhoto[]; index: number | null; onIndex: (i: number | null) => void }) {
  const { t, locale } = useI18n();
  const ready = photos.filter((p) => p.status === 'ready');
  const current = index === null ? null : photos[index];
  const pos = current ? ready.indexOf(current) : -1;
  const go = (by: number) => {
    const next = ready[pos + by];
    if (next) onIndex(photos.indexOf(next));
  };
  return (
    <Modal visible={!!current && current.status === 'ready'} animationType="fade" onRequestClose={() => onIndex(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.sm }}>
          <Text variant="label" color="#fff">
            {t('feed.photoOf', { n: pos + 1, total: ready.length })}
          </Text>
          <Pressable onPress={() => onIndex(null)} accessibilityRole="button" accessibilityLabel={t('plan.close')} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <X size={24} color="#fff" />
          </Pressable>
        </View>
        {current?.url ? (
          <Image source={{ uri: current.url }} style={{ flex: 1 }} resizeMode="contain" accessibilityIgnoresInvertColors />
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {current && (
          <View style={{ padding: spacing.lg, gap: 4 }}>
            <Text color="#fff">{takenLine(current, t, locale)}</Text>
            <Text variant="caption" color="#ccc">
              {t('feed.sent', { time: formatDateTime(locale, current.uploadedAt) })}
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
              <Pressable onPress={() => go(-1)} disabled={pos <= 0} accessibilityRole="button" accessibilityLabel={t('feed.previous')} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: pos <= 0 ? 0.3 : 1 }}>
                <ChevronLeft size={28} color="#fff" />
              </Pressable>
              <Pressable onPress={() => current.url && void Linking.openURL(current.url)} accessibilityRole="link" style={{ justifyContent: 'center' }}>
                <Text variant="label" color="#fff">
                  {t('feed.openOriginal')}
                </Text>
              </Pressable>
              <Pressable onPress={() => go(1)} disabled={pos >= ready.length - 1} accessibilityRole="button" accessibilityLabel={t('feed.next')} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: pos >= ready.length - 1 ? 0.3 : 1 }}>
                <ChevronRight size={28} color="#fff" />
              </Pressable>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

/**
 * Before/after slider: the later photo sits on top, clipped at the handle; drag to compare.
 * Screen readers get "adjustable" with increment/decrement steps of 10%.
 */
export function BeforeAfter({ before, after, height = 240 }: { before: UpdatePhoto; after: UpdatePhoto; height?: number }) {
  const { t, locale } = useI18n();
  const { colors } = useJengaTheme();
  const [width, setWidth] = useState(0);
  const [split, setSplit] = useState(0.5);
  const start = useRef({ x: 0, split: 0.5 });
  const move = (e: GestureResponderEvent) => {
    if (!width) return;
    const dx = e.nativeEvent.pageX - start.current.x;
    setSplit(Math.min(1, Math.max(0, start.current.split + dx / width)));
  };
  const src = (p: UpdatePhoto) => p.thumbUrl ?? p.url ?? '';
  const label = (p: UpdatePhoto) => formatDate(locale, photoTime(p));
  const percent = Math.round(split * 100);
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={t('feed.compareLabel', { percent })}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => setSplit((s) => Math.min(1, Math.max(0, s + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1))))}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        // Tap anywhere moves the handle there; then drag.
        const x = e.nativeEvent.locationX;
        const s = width ? Math.min(1, Math.max(0, x / width)) : split;
        setSplit(s);
        start.current = { x: e.nativeEvent.pageX, split: s };
      }}
      onResponderMove={move}
      style={{ height, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceSunken }}
    >
      <Image source={{ uri: src(before) }} style={{ position: 'absolute', width, height }} resizeMode="cover" accessibilityIgnoresInvertColors />
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: width * split, overflow: 'hidden' }} pointerEvents="none">
        <Image source={{ uri: src(after) }} style={{ width, height }} resizeMode="cover" accessibilityIgnoresInvertColors />
      </View>
      <Tag text={`${t('feed.after')} · ${label(after)}`} side="left" />
      <Tag text={`${t('feed.before')} · ${label(before)}`} side="right" />
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: width * split - 1, width: 2, backgroundColor: '#fff' }} />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: height / 2 - 20,
          left: width * split - 20,
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: '#fff',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ChevronsLeftRight size={20} color={colors.ink} />
      </View>
    </View>
  );
}

function Tag({ text, side }: { text: string; side: 'left' | 'right' }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 8, [side]: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <Text variant="caption" color="#fff">
        {text}
      </Text>
    </View>
  );
}

export const stageStatusKey = (s: string) => `feed.status_${s}` as MessageKey;
