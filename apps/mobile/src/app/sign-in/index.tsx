import { DEMO_CODE, DEMO_PEOPLE, type DemoPerson, type OtpChannel } from '@jengalink/contracts';
import { radius, spacing } from '@jengalink/ui';
import { Button, Text, useJengaTheme } from '@jengalink/ui/native';
import { Redirect, router } from 'expo-router';
import { ArrowRight, Mail, Smartphone } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { languageNames, locales } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { JengaMark } from '@/components/JengaMark';
import { useLocale } from '@/lib/locale';
import { ApiError, useAuth } from '@/lib/auth';
import { useDemo } from '@/lib/environment';

/**
 * Sign in (spec §26.5): phone OTP is the default; owners abroad use email.
 * No passwords. One field, one button.
 */
export default function SignInScreen() {
  const { status, startOtp, verifyOtp } = useAuth();
  const demo = useDemo();
  const { t, locale } = useI18n();
  const { setLocale } = useLocale();
  const { colors, status: tone } = useJengaTheme();
  const [channel, setChannel] = useState<OtpChannel>('sms');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);

  if (status === 'signedIn') return <Redirect href="/" />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const destination = channel === 'sms' ? `+250${value.replace(/\D/g, '').replace(/^0/, '')}` : value;
      const res = await startOtp(channel, destination, locale);
      router.push({ pathname: '/sign-in/code', params: { challengeId: res.challengeId, sentTo: res.sentTo, channel, destination, resendAfter: res.resendAfter } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  /** Demo environment: one tap signs in as a demo person (fixed code, nothing is sent). */
  const signInAs = async (person: DemoPerson) => {
    setBusy(true);
    setError(null);
    try {
      const res = await startOtp('sms', `+250${person.phone.slice(1)}`, locale);
      await verifyOtp(res.challengeId, DEMO_CODE, locale);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  const input = {
    flex: 1,
    // The whole box is the tap target (44 px), not just the line of text.
    alignSelf: 'stretch',
    minHeight: 44,
    color: colors.ink,
    fontSize: 20,
    fontFamily: 'Inter_500Medium',
    padding: 0,
    outlineWidth: 0, // the field border shows focus; no browser outline on web
  } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.xl, gap: spacing.xl, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <JengaMark size={44} />
              <View accessibilityRole="radiogroup" accessibilityLabel={t('more.chooseLanguage')} style={{ flexDirection: 'row', gap: 4 }}>
                {locales.map((l) => (
                  <Pressable
                    key={l}
                    onPress={() => void setLocale(l)}
                    accessibilityRole="radio"
                    accessibilityLabel={languageNames[l]}
                    aria-checked={l === locale}
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: radius.pill,
                      backgroundColor: l === locale ? colors.primarySoft : 'transparent',
                    }}
                  >
                    <Text variant="label" color={l === locale ? colors.primary : colors.inkMuted}>
                      {l.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Text variant="screenTitle">{t('auth.welcome')}</Text>
            <Text muted>{t('auth.welcomeLead')}</Text>
          </View>

          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', padding: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken }}>
            {(
              [
                { key: 'sms', label: t('auth.phone'), icon: Smartphone },
                { key: 'email', label: t('auth.email'), icon: Mail },
              ] as const
            ).map(({ key, label, icon: Icon }) => {
              const on = channel === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="radio"
                  aria-checked={on}
                  onPress={() => {
                    setChannel(key);
                    setValue('');
                    setError(null);
                  }}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: radius.pill,
                    backgroundColor: on ? colors.surface : 'transparent',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <Icon size={18} color={on ? colors.ink : colors.inkMuted} />
                  <Text variant="label" color={on ? colors.ink : colors.inkMuted}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ gap: spacing.sm }}>
            <Text variant="label">{channel === 'sms' ? t('auth.phoneLabel') : t('auth.emailLabel')}</Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                height: 58,
                paddingHorizontal: spacing.lg,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: error ? tone('problem').color : focused ? colors.primary : colors.borderStrong,
                backgroundColor: colors.surface,
              }}
            >
              {channel === 'sms' && (
                <Text variant="bodyStrong" muted style={{ fontSize: 20 }}>
                  +250
                </Text>
              )}
              <TextInput
                accessibilityLabel={channel === 'sms' ? 'Mobile number' : t('auth.emailLabel')}
                value={value}
                onChangeText={setValue}
                onSubmitEditing={submit}
                placeholder={channel === 'sms' ? '78 123 4567' : 'you@example.com'}
                placeholderTextColor={colors.inkSubtle}
                keyboardType={channel === 'sms' ? 'phone-pad' : 'email-address'}
                textContentType={channel === 'sms' ? 'telephoneNumber' : 'emailAddress'}
                autoComplete={channel === 'sms' ? 'tel' : 'email'}
                autoCapitalize="none"
                autoFocus
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={input}
              />
            </View>
            <Text variant="caption" color={error ? tone('problem').color : colors.inkMuted}>
              {error ?? (channel === 'sms' ? t('auth.phoneHint') : t('auth.emailHint'))}
            </Text>
          </View>

          <Button title={t('auth.sendCode')} size="lg" block icon={ArrowRight} loading={busy} disabled={value.trim().length < (channel === 'sms' ? 9 : 5)} onPress={submit} />

          {demo && (
            <View style={{ gap: spacing.sm, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text variant="sectionTitle">{t('demo.tryTitle')}</Text>
              <Text variant="caption" muted>
                {t('demo.codeHint', { code: DEMO_CODE })}
              </Text>
              {DEMO_PEOPLE.map((p) => (
                <Pressable
                  key={p.key}
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void signInAs(p)}
                  style={{
                    minHeight: 52,
                    justifyContent: 'center',
                    paddingHorizontal: spacing.lg,
                    paddingVertical: 6,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.borderStrong,
                    backgroundColor: colors.surface,
                  }}
                >
                  <Text variant="bodyStrong">{p.name}</Text>
                  <Text variant="caption" muted>
                    {t(`server.role_${p.role}`)} · {t(`demo.project_${p.project}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
