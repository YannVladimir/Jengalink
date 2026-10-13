import { useI18n } from '@jengalink/i18n/react';
import { Button, StateView } from '@jengalink/ui/web';

/** Shown instead of a blank page when the app crashes; the error is already reported. */
export default function CrashScreen({ eventId, onRetry }: { eventId?: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <StateView
        kind="error"
        title={t('common.somethingWrong')}
        message={eventId ? `Ref ${eventId.slice(0, 8)}` : undefined}
        action={<Button onClick={onRetry}>{t('common.tryAgain')}</Button>}
      />
    </div>
  );
}
