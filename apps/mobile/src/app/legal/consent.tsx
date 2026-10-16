import { CURRENT_LEGAL_VERSION } from '@jengalink/contracts';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Button, Text, useJengaTheme } from '@jengalink/ui/native';
import { Redirect, router } from 'expo-router';
import { Check, FileText, Shield, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { JengaMark } from '@/components/JengaMark';
import { ApiError, useAuth } from '@/lib/auth';

/**
 * Shown once per legal version (Build Plan Phase 6): a gate between naming yourself (welcome) and
 * the app itself, and again whenever CURRENT_LEGAL_VERSION changes.
 */
export default function ConsentScreen() {
  const { status, user, acceptLegal } = useAuth();
  const { t } = useI18n();
  const { colors, status: tone } = useJengaTheme();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'signedOut') return <Redirect href="/sign-in" />;
  if (!user?.displayName) return <Redirect href="/welcome" />;
  if (user.legalAcceptedVersion === CURRENT_LEGAL_VERSION) return <Redirect href="/" />;

  const continueNow = async () => {
    if (!checked) {
      setError(t('legal.consentMustAccept'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await acceptLegal(CURRENT_LEGAL_VERSION);
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
          <Text variant="screenTitle">{t('legal.consentTitle')}</Text>
          <Text muted>{t('legal.consentLead')}</Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          <LegalLink icon={Shield} label={t('legal.readPrivacy')} onPress={() => router.push('/legal/privacy')} />
          <LegalLink icon={FileText} label={t('legal.readTerms')} onPress={() => router.push('/legal/terms')} />
        </View>

        <Pressable
          onPress={() => {
            setChecked((c) => !c);
            setError(null);
          }}
          accessibilityRole="checkbox"
          aria-checked={checked}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 }}
        >
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              borderWidth: 1.5,
              borderColor: checked ? colors.primary : colors.borderStrong,
              backgroundColor: checked ? colors.primary : colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {checked && <Check size={16} color={colors.onPrimary} />}
          </View>
          <Text style={{ flex: 1 }}>{t('legal.consentCheckbox')}</Text>
        </Pressable>

        {error && (
          <Text variant="caption" color={tone('problem').color}>
            {error}
          </Text>
        )}

        <Button title={t('legal.consentAccept')} size="lg" block loading={busy} disabled={!checked} onPress={continueNow} />
      </View>
    </SafeAreaView>
  );
}

function LegalLink({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  const { colors } = useJengaTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 52,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.borderStrong,
        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
      })}
    >
      <Icon size={18} color={colors.structure} />
      <Text variant="bodyStrong" style={{ flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}
