import type { OtpChannel } from '@jengalink/contracts';
import { radius, spacing } from '@jengalink/ui';
import { Text, useJengaTheme } from '@jengalink/ui/native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '@jengalink/i18n/react';
import { ApiError, useAuth } from '@/lib/auth';

const LENGTH = 6;

/** Six boxes, one hidden field: the phone can autofill the SMS code. Submits on the 6th digit. */
export default function CodeScreen() {
  const params = useLocalSearchParams<{ challengeId: string; sentTo: string; channel: OtpChannel; destination: string; resendAfter: string }>();
  const { status, user, verifyOtp, startOtp } = useAuth();
  const { t, locale } = useI18n();
  const { colors, status: tone } = useJengaTheme();
  const [challengeId, setChallengeId] = useState(params.challengeId);
  const [resendAfter, setResendAfter] = useState(params.resendAfter);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (status === 'signedIn') return <Redirect href={user?.displayName ? '/' : '/welcome'} />;

  const waitSeconds = Math.max(0, Math.ceil((new Date(resendAfter).getTime() - now) / 1000));

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(challengeId, value, locale);
    } catch (err) {
      setCode('');
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      const res = await startOtp(params.channel, params.destination, locale);
      setChallengeId(res.challengeId);
      setResendAfter(res.resendAfter);
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <View style={{ padding: spacing.xl, gap: spacing.xl }}>
        <View style={{ gap: spacing.sm }}>
          <Text variant="screenTitle">{t('auth.enterCode')}</Text>
          <Text muted>
            {t('auth.codeSentTo', { destination: params.sentTo })}
          </Text>
        </View>

        <Pressable onPress={() => inputRef.current?.focus()} accessibilityLabel={t('auth.codeLabel')} style={{ flexDirection: 'row', gap: spacing.sm }}>
          {Array.from({ length: LENGTH }, (_, i) => {
            const filled = i < code.length;
            const active = i === code.length && !busy;
            return (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 60,
                  borderRadius: radius.md,
                  borderWidth: active ? 2 : 1.5,
                  borderColor: error ? tone('problem').color : active ? colors.primary : colors.borderStrong,
                  backgroundColor: colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text variant="screenTitle" style={{ fontVariant: ['tabular-nums'] }}>
                  {filled ? code[i] : ''}
                </Text>
              </View>
            );
          })}
        </Pressable>
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(t) => {
            const digits = t.replace(/\D/g, '').slice(0, LENGTH);
            setCode(digits);
            if (digits.length === LENGTH) void submit(digits);
          }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          autoFocus
          maxLength={LENGTH}
          caretHidden
          style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
        />

        <View style={{ minHeight: 24 }}>
          {busy ? (
            <ActivityIndicator color={colors.primary} />
          ) : error ? (
            <View accessibilityRole="alert">
              <Text variant="label" color={tone('problem').color}>
                {error}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text variant="label" color={colors.primary}>
              {params.channel === 'sms' ? t('auth.changeNumber') : t('auth.changeEmail')}
            </Text>
          </Pressable>
          <Pressable disabled={waitSeconds > 0} onPress={resend} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text variant="label" color={waitSeconds > 0 ? colors.inkMuted : colors.primary}>
              {waitSeconds > 0 ? t('auth.newCodeIn', { seconds: waitSeconds }) : t('auth.sendNewCode')}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
