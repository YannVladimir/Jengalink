import { useI18n } from '@jengalink/i18n/react';
import { FlaskConical } from 'lucide-react';
import { useEffect } from 'react';
import { useDemo } from '../lib/environment';

/** On every page of a demo environment, so nobody takes the made-up data for real. */
export function DemoBanner() {
  const demo = useDemo();
  const { t } = useI18n();
  useEffect(() => {
    document.documentElement.classList.toggle('is-demo', demo);
  }, [demo]);
  if (!demo) return null;
  return (
    <div className="demo-banner" role="note">
      <FlaskConical size={16} aria-hidden />
      {t('demo.banner')}
    </div>
  );
}
