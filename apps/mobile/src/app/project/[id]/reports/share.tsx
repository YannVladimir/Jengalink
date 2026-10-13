import { type CreatedReportShare, type ReportShareView, SHARE_EXPIRY_DAYS, SHARE_SECTIONS, type ShareSection, type SharedReportView, type WeeklyReportView } from '@jengalink/contracts';
import { ApiError, request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Eye, Link2, MessageCircle, Share2, Square, SquareCheck } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, Text as RNText, ScrollView, Share, View } from 'react-native';
import { ReportBody } from '@/components/report';
import { api, useAuth } from '@/lib/auth';

type Days = (typeof SHARE_EXPIRY_DAYS)[number];
const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);

/** Share a report outside the project (spec §26.5): sections, expiry, a privacy preview, then the phone's share menu. */
export default function ShareReportScreen() {
  const { id, reportId } = useLocalSearchParams<{ id: string; reportId: string }>();
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [report, setReport] = useState<WeeklyReportView | null>(null);
  const [links, setLinks] = useState<ReportShareView[]>([]);
  const [failed, setFailed] = useState(false);
  const [sections, setSections] = useState<ShareSection[]>(['work', 'photos', 'next']);
  const [days, setDays] = useState<Days>(7);
  const [allowDownload, setAllowDownload] = useState(false);
  const [preview, setPreview] = useState<SharedReportView | null>(null);
  const [made, setMade] = useState<CreatedReportShare | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = { id, reportId };

  const loadLinks = useCallback(
    () => withRefresh(() => request(() => api.GET('/v1/projects/{id}/reports/{reportId}/shares', { params: { path: { id, reportId } } }))).then(setLinks),
    [id, reportId, withRefresh],
  );
  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([withRefresh(() => request(() => api.GET('/v1/projects/{id}/reports/{reportId}', { params: { path: { id, reportId } } }))), loadLinks()])
        .then(([r]) => live && setReport(r))
        .catch(() => live && setFailed(true));
      return () => {
        live = false;
      };
    }, [id, reportId, withRefresh, loadLinks]),
  );

  if (failed) return <StateView kind="no-permission" title={t('common.somethingWrong')} />;
  if (!report)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );

  // Money can only be shared by someone who sees it (the API refuses it otherwise).
  const choices = SHARE_SECTIONS.filter((s) => s !== 'money' || report.data.money);
  const body = { sections, expiresInDays: days, allowDownload };
  const changed = () => {
    setPreview(null);
    setMade(null);
  };
  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  };
  const message = made
    ? t('share.message', {
        project: report.data.projectName,
        week: t('report.weekLine', { start: formatDate(locale, fromIsoDate(report.weekStart)), end: formatDate(locale, fromIsoDate(report.weekEnd)) }),
        url: made.url,
      })
    : '';
  const revoke = (l: ReportShareView) => {
    const go = () =>
      run(l.id, async () => {
        const v = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/reports/{reportId}/shares/{shareId}/revoke', { params: { path: { ...path, shareId: l.id } } })));
        setLinks((x) => x.map((y) => (y.id === v.id ? v : y)));
      });
    // Alert has no buttons on the web build.
    if (Platform.OS === 'web') {
      if (window.confirm(t('share.revokeConfirm'))) void go();
    } else
      Alert.alert(t('share.revoke'), t('share.revokeConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('share.revoke'), style: 'destructive', onPress: () => void go() },
      ]);
  };
  const check = (on: boolean, label: string, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="checkbox" aria-checked={on} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 }}>
      {on ? <SquareCheck size={22} color={colors.primary} /> : <Square size={22} color={colors.inkMuted} />}
      <Text style={{ flex: 1 }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Text variant="caption" muted>
        {t('share.hint')}
      </Text>
      <Card>
        <Text variant="label" muted>
          {t('share.whatToShare')}
        </Text>
        <Text variant="caption" muted style={{ marginBottom: spacing.xs }}>
          {t('share.always')}
        </Text>
        {choices.map((s) =>
          check(sections.includes(s), t(`share.section_${s}`), () => {
            setSections((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));
            changed();
          }),
        )}
        {sections.length === 0 && (
          <Text variant="caption" muted>
            {t('share.pickOne')}
          </Text>
        )}
        <Text variant="label" muted style={{ marginTop: spacing.md, marginBottom: spacing.sm }}>
          {t('share.expiryTitle')}
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }} accessibilityRole="radiogroup">
          {SHARE_EXPIRY_DAYS.map((d) => {
            const on = d === days;
            return (
              <Pressable
                key={d}
                accessibilityRole="radio"
                aria-checked={on}
                onPress={() => {
                  setDays(d);
                  changed();
                }}
                style={{
                  minHeight: 44,
                  paddingHorizontal: spacing.md,
                  justifyContent: 'center',
                  borderRadius: radius.pill,
                  borderWidth: 1.5,
                  borderColor: on ? colors.primary : colors.borderStrong,
                  backgroundColor: on ? colors.primarySoft : colors.surface,
                }}
              >
                <Text variant="bodyStrong" color={on ? colors.primary : colors.ink}>
                  {t(`share.expiry_${d}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ marginTop: spacing.sm }}>
          {check(allowDownload, t('share.allowDownload'), () => {
            setAllowDownload((x) => !x);
            changed();
          })}
        </View>
        <View style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }}>
          <Text variant="caption" muted>
            {t('share.neverShown')}
          </Text>
        </View>
      </Card>

      <Button
        title={t('share.preview')}
        icon={Eye}
        variant="secondary"
        loading={busy === 'preview'}
        onPress={() => run('preview', async () => setPreview(await withRefresh(() => request(() => api.POST('/v1/projects/{id}/reports/{reportId}/shares/preview', { params: { path }, body })))))}
      />
      <Button
        title={t('share.createLink')}
        icon={Link2}
        loading={busy === 'create'}
        onPress={() =>
          run('create', async () => {
            setMade(await withRefresh(() => request(() => api.POST('/v1/projects/{id}/reports/{reportId}/shares', { params: { path }, body }))));
            await loadLinks();
          })
        }
      />
      {error && (
        <Text variant="caption" color={status('problem').color} alert>
          {error}
        </Text>
      )}

      {made && (
        <Card>
          <Text variant="bodyStrong" color={status('paid').color}>
            {t('share.linkReady', { date: formatDate(locale, made.expiresAt) })}
          </Text>
          <RNText selectable style={{ marginVertical: spacing.sm, color: colors.inkMuted, fontSize: 13 }}>
            {made.url}
          </RNText>
          <View style={{ gap: spacing.sm }}>
            {/* The phone's share menu: WhatsApp, SMS, email, copy… */}
            <Button title={t('share.shareVia')} icon={Share2} onPress={() => void Share.share({ message }).catch(() => undefined)} />
            <Button title={t('share.whatsapp')} icon={MessageCircle} variant="secondary" onPress={() => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`)} />
          </View>
        </Card>
      )}

      {preview && (
        <View style={{ gap: spacing.md, padding: spacing.md, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.borderStrong, borderRadius: radius.lg }}>
          <Text variant="caption" color={colors.primary}>
            {t('share.previewBanner')}
          </Text>
          <View>
            <Text variant="caption" muted>
              {[preview.data.projectName, preview.data.place].filter(Boolean).join(' · ')}
            </Text>
            <Text variant="sectionTitle">{t('report.weekLine', { start: formatDate(locale, fromIsoDate(preview.weekStart)), end: formatDate(locale, fromIsoDate(preview.weekEnd)) })}</Text>
            <Text variant="caption" muted>
              {t('share.sharedBy', { name: preview.sharedByName ?? t('claims.someone'), org: preview.data.organizationName })}
            </Text>
          </View>
          <ReportBody data={preview.data} photos={preview.photos} sections={preview.sections} />
        </View>
      )}

      <Text variant="label" muted style={{ marginTop: spacing.sm }}>
        {t('share.linksTitle')}
      </Text>
      {links.length === 0 && <Text muted>{t('share.noLinks')}</Text>}
      {links.map((l) => {
        const tone = l.status === 'active' ? status('paid').color : colors.inkMuted;
        return (
          <Card key={l.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {l.sections.length ? l.sections.map((s) => t(`share.section_${s}`)).join(' · ') : t('report.progressTitle')}
              </Text>
              <Text variant="caption" color={tone}>
                {t(`share.status_${l.status}`)}
              </Text>
            </View>
            <Text variant="caption" muted>
              {t('share.linkLine', { name: l.createdByName ?? t('claims.someone'), date: formatDate(locale, l.createdAt), until: formatDate(locale, l.expiresAt) })}
            </Text>
            <Text variant="caption" muted>
              {t('share.opens', { count: l.viewCount })}
            </Text>
            {l.canRevoke && (
              <View style={{ marginTop: spacing.sm }}>
                <Button title={t('share.revoke')} variant="secondary" loading={busy === l.id} onPress={() => revoke(l)} />
              </View>
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}
