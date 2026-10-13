import { radius, spacing } from '@jengalink/ui';
import { Button, Text, useJengaTheme } from '@jengalink/ui/native';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { JengaMark } from '@/components/JengaMark';
import { useI18n } from '@jengalink/i18n/react';
import { ApiError, useAuth } from '@/lib/auth';

/** First sign-in only: the name others on the project will see. */
export default function WelcomeScreen() {
  const { status, user, updateMe } = useAuth();
  const { t } = useI18n();
  const { colors, status: tone } = useJengaTheme();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'signedOut') return <Redirect href="/sign-in" />;
  if (user?.displayName) return <Redirect href="/" />;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateMe({ displayName: name.trim() });
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1, padding: spacing.xl, gap: spacing.xl, justifyContent: 'center' }}>
        <View style={{ gap: spacing.md }}>
          <JengaMark size={44} />
          <Text variant="screenTitle">{t('auth.nameTitle')}</Text>
          <Text muted>{t('auth.nameLead')}</Text>
        </View>
        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('auth.nameLabel')}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            onSubmitEditing={save}
            placeholder={t('auth.namePlaceholder')}
            placeholderTextColor={colors.inkSubtle}
            textContentType="name"
            autoComplete="name"
            autoFocus
            style={{
              height: 58,
              paddingHorizontal: spacing.lg,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: error ? tone('problem').color : colors.borderStrong,
              backgroundColor: colors.surface,
              color: colors.ink,
              fontSize: 18,
              fontFamily: 'Inter_500Medium',
              outlineWidth: 0,
            }}
          />
          {error && (
            <Text variant="caption" color={tone('problem').color}>
              {error}
            </Text>
          )}
        </View>
        <Button title={t('common.continue')} size="lg" block loading={busy} disabled={name.trim().length < 2} onPress={save} />
      </View>
    </SafeAreaView>
  );
}
