import { exifToIso, MAX_UPDATE_PHOTOS, type ProjectStage, type ProjectSummary } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Button, OfflineBanner, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Check, CloudOff, Images, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomAction } from '@/components/ui';
import { api, useAuth } from '@/lib/auth';
import { keepPhoto } from '@/lib/offline-store';
import { useOutbox } from '@/lib/outbox';
import { canSend, localDate, newId, type OutboxItem, type OutboxPhoto } from '@/lib/outbox-core';

const REPORTERS = ['contractor', 'supervisor', 'manager'];
const PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

const blankItem = (project: ProjectSummary): OutboxItem => {
  const now = new Date().toISOString();
  return {
    id: newId('draft'),
    sendKey: newId('upd'),
    status: 'draft',
    projectId: project.id,
    projectName: project.name,
    stageId: null,
    stageName: '',
    eventDate: localDate(),
    note: '',
    blockers: '',
    photos: [],
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
  };
};
const hasContent = (i: OutboxItem) => i.photos.length > 0 || i.note.trim() !== '' || i.blockers.trim() !== '';

/**
 * Site update composer (Phase 3): stage, photos, short note, blocker — under a minute.
 * Works offline: every change is saved on the phone as a draft; "Send" queues it and
 * it goes out by itself when there is a connection (see lib/outbox.tsx).
 */
export default function NewUpdateScreen() {
  const params = useLocalSearchParams<{ projectId?: string; draftId?: string }>();
  const { colors, status } = useJengaTheme();
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const outbox = useOutbox();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [offline, setOffline] = useState(false);
  const [item, setItem] = useState<OutboxItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<'sent' | 'queued' | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);

  // Projects: from the server when possible, otherwise the copy saved on this phone.
  useEffect(() => {
    if (!outbox.ready) return;
    let live = true;
    const pick = (list: ProjectSummary[]) => list.filter((p) => p.status === 'active' && p.myRoles.some((r) => REPORTERS.includes(r)));
    // The draft being edited: an existing one from the outbox, or a new one.
    const start = (mine: ProjectSummary[]) => {
      setProjects(mine);
      const existing = params.draftId ? outbox.getItem(params.draftId) : undefined;
      if (existing && existing.status !== 'queued') setItem(existing);
      else {
        const project = mine.find((p) => p.id === params.projectId) ?? mine[0];
        if (project) setItem(blankItem(project));
      }
    };
    withRefresh(() => request(() => api.GET('/v1/projects')))
      .then((list) => {
        if (!live) return;
        outbox.cacheProjects(list);
        start(pick(list));
      })
      .catch(() => {
        if (!live) return;
        setOffline(true);
        start(pick(outbox.cache.projects ?? []));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outbox.ready, withRefresh]);

  // Stages for the chosen project, with the same offline fallback.
  const projectId = item?.projectId;
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    const apply = (list: ProjectStage[]) => {
      setStages(list);
      setItem((cur) => {
        if (!cur || (cur.stageId && list.some((s) => s.id === cur.stageId))) return cur;
        const open = list.filter((s) => s.status !== 'accepted');
        const first = open.find((s) => s.status === 'in_progress') ?? open[0] ?? list[0];
        return first ? { ...cur, stageId: first.id, stageName: first.name } : cur;
      });
    };
    withRefresh(() => request(() => api.GET('/v1/projects/{id}/stages', { params: { path: { id: projectId } } })))
      .then((list) => {
        if (!live) return;
        outbox.cacheStages(projectId, list);
        apply(list);
      })
      .catch(() => {
        if (!live) return;
        setOffline(true);
        apply(outbox.cache.stages?.[projectId] ?? []);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, withRefresh]);

  // Every change is written to the phone, so nothing is lost if the app closes.
  const change = (patch: Partial<OutboxItem>) => {
    setDraftSaved(false);
    setItem((cur) => {
      if (!cur) return cur;
      const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
      if (hasContent(next) || outbox.items.some((i) => i.id === next.id)) outbox.saveItem(next);
      return next;
    });
  };

  const addAssets = async (assets: ImagePicker.ImagePickerAsset[], fromCamera: boolean) => {
    if (!item) return;
    const now = new Date().toISOString();
    const room = MAX_UPDATE_PHOTOS - item.photos.length;
    const kept: OutboxPhoto[] = [];
    for (const a of assets.slice(0, room)) {
      const contentType = (PHOTO_TYPES.includes(a.mimeType ?? '') ? a.mimeType : 'image/jpeg') as OutboxPhoto['contentType'];
      kept.push({
        // A copy in app storage: the picker's own file may be cleaned up by the system.
        localUri: await keepPhoto(a.uri, contentType),
        contentType,
        // The camera shot is "now"; library photos keep their EXIF time when there is one.
        capturedAt: exifToIso(a.exif?.DateTimeOriginal) ?? (fromCamera ? now : null),
      });
    }
    change({ photos: [...item.photos, ...kept] });
  };

  const takePhoto = async () => {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError(t('composer.cameraDenied'));
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, exif: true });
    if (!res.canceled) await addAssets(res.assets, true);
  };

  const pickPhotos = async () => {
    if (!item) return;
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      exif: true,
      allowsMultipleSelection: true,
      selectionLimit: MAX_UPDATE_PHOTOS - item.photos.length,
    });
    if (!res.canceled) await addAssets(res.assets, false);
  };

  const send = async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    outbox.saveItem(item);
    const outcome = await outbox.submit(item.id);
    setBusy(false);
    if (outcome === 'failed') {
      const failed = outbox.getItem(item.id);
      setError(failed?.lastError ?? t('composer.photoFailed'));
      if (failed) setItem(failed);
    } else setResult(outcome);
  };

  const saveDraft = () => {
    if (item && hasContent(item)) outbox.saveItem(item);
    setDraftSaved(true);
    router.back();
  };

  if (!projects || (projects.length > 0 && !item))
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  if (projects.length === 0 || !item)
    return (
      <StateView
        kind={offline ? 'offline' : 'empty'}
        title={t('composer.noProjectTitle')}
        message={offline ? t('sync.noCachedProjects') : t('composer.noProjectLead')}
      />
    );

  if (result) {
    const sent = result === 'sent';
    const tone = sent ? status('paid') : status('waiting');
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flex: 1, padding: spacing.xl, gap: spacing.lg, justifyContent: 'center' }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.soft }}>
            {sent ? <Check size={32} color={tone.color} /> : <CloudOff size={30} color={tone.color} />}
          </View>
          <Text variant="screenTitle">{sent ? t('composer.sentTitle') : t('sync.queuedTitle')}</Text>
          <Text muted>{sent ? t('composer.sentLead') : t('sync.queuedLead')}</Text>
          <Button title={t('wizard.doneButton')} size="lg" block onPress={() => router.back()} />
          <Button
            title={t('composer.addAnother')}
            variant="secondary"
            size="lg"
            block
            onPress={() => {
              const project = projects.find((p) => p.id === item.projectId) ?? projects[0];
              setItem({ ...blankItem(project), stageId: item.stageId, stageName: item.stageName });
              setResult(null);
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const ready = canSend(item) && !busy;
  const shownStages = stages.some((s) => s.status !== 'accepted') ? stages.filter((s) => s.status !== 'accepted') : stages;
  const input = {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.ink,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    outlineWidth: 0,
  } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: 180 }} keyboardShouldPersistTaps="handled">
        {offline && <OfflineBanner />}

        {projects.length > 1 && (
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">{t('composer.project')}</Text>
            <Chips
              items={projects.map((p) => ({ id: p.id, label: p.name }))}
              value={item.projectId}
              onChange={(id) => {
                const p = projects.find((x) => x.id === id);
                if (p) change({ projectId: p.id, projectName: p.name, stageId: null, stageName: '' });
              }}
            />
          </View>
        )}

        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('composer.whichStage')}</Text>
          <Chips
            items={shownStages.map((s) => ({ id: s.id, label: s.name }))}
            value={item.stageId}
            onChange={(id) => change({ stageId: id, stageName: stages.find((s) => s.id === id)?.name ?? '' })}
          />
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('composer.photos', { count: item.photos.length })}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {item.photos.map((p, i) => (
              <View key={`${i}-${p.localUri.slice(-24)}`} style={{ width: 96, height: 96 }}>
                <Image source={{ uri: p.localUri }} style={{ width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }} accessibilityIgnoresInvertColors />
                <Pressable
                  onPress={() => change({ photos: item.photos.filter((_, j) => j !== i) })}
                  accessibilityRole="button"
                  accessibilityLabel={t('composer.removePhoto', { n: i + 1 })}
                  hitSlop={8}
                  style={{ position: 'absolute', top: 4, right: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={16} color="#fff" />
                </Pressable>
              </View>
            ))}
            {item.photos.length < MAX_UPDATE_PHOTOS && (
              <Pressable
                onPress={() => void takePhoto()}
                accessibilityRole="button"
                accessibilityLabel={t('composer.takePhoto')}
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: radius.md,
                  borderWidth: 2,
                  borderStyle: 'dashed',
                  borderColor: colors.primary,
                  backgroundColor: colors.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                <Camera size={26} color={colors.primary} />
                <Text variant="caption" color={colors.primary}>
                  {t('composer.takePhoto')}
                </Text>
              </Pressable>
            )}
          </View>
          {item.photos.length < MAX_UPDATE_PHOTOS && (
            <View style={{ alignSelf: 'flex-start' }}>
              <Button title={t('composer.fromGallery')} icon={Images} variant="ghost" onPress={() => void pickPhotos()} />
            </View>
          )}
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('composer.whatHappened')}</Text>
          <TextInput
            accessibilityLabel={t('composer.whatHappened')}
            value={item.note}
            onChangeText={(note) => change({ note })}
            placeholder={t('composer.whatHappenedPlaceholder')}
            placeholderTextColor={colors.inkSubtle}
            multiline
            maxLength={500}
            style={{ ...input, minHeight: 96, textAlignVertical: 'top' }}
          />
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('composer.blocking')}</Text>
          <TextInput
            accessibilityLabel={t('composer.blocking')}
            value={item.blockers}
            onChangeText={(blockers) => change({ blockers })}
            placeholder={t('composer.blockingPlaceholder')}
            placeholderTextColor={colors.inkSubtle}
            maxLength={300}
            style={input}
          />
        </View>

        {error && (
          <Text variant="caption" color={status('problem').color} alert>
            {error}
          </Text>
        )}
      </ScrollView>

      <BottomAction>
        <View style={{ gap: spacing.xs }}>
          <Text variant="caption" muted style={{ textAlign: 'center' }}>
            {draftSaved ? t('sync.draftSaved') : !ready && !busy ? t('composer.needPhotoOrNote') : ' '}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title={t('composer.saveDraft')} variant="secondary" size="lg" disabled={busy || !hasContent(item)} onPress={saveDraft} />
            <View style={{ flex: 1 }}>
              <Button
                title={busy ? t('composer.sending') : item.photos.length ? t('composer.sendWithPhotos', { count: item.photos.length }) : t('composer.send')}
                size="lg"
                block
                loading={busy}
                disabled={!ready}
                onPress={() => void send()}
              />
            </View>
          </View>
        </View>
      </BottomAction>
    </SafeAreaView>
  );
}

function Chips({ items, value, onChange }: { items: { id: string; label: string }[]; value: string | null; onChange: (id: string) => void }) {
  const { colors } = useJengaTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <Pressable
            key={it.id}
            onPress={() => onChange(it.id)}
            accessibilityRole="radio"
            aria-checked={on}
            style={{
              minHeight: 44,
              paddingHorizontal: spacing.lg,
              borderRadius: radius.pill,
              borderWidth: 1.5,
              borderColor: on ? colors.primary : colors.borderStrong,
              backgroundColor: on ? colors.primarySoft : colors.surface,
              justifyContent: 'center',
            }}
          >
            <Text variant="label" color={on ? colors.primary : colors.ink}>
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
