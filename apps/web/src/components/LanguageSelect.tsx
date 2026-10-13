import { isReviewed, languageNames, locales, type Locale } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { Languages } from 'lucide-react';
import { useLocale } from '../lib/locale-context';

/** English, Kinyarwanda, French, Swahili — each written in its own language. */
export function LanguageSelect({ className }: { className?: string }) {
  const { t } = useI18n();
  const { locale, setLocale } = useLocale();
  return (
    <label className={className ?? 'lang-select'}>
      <Languages size={16} aria-hidden />
      <span className="lang-select__label">{t('common.language')}</span>
      <select value={locale} onChange={(e) => void setLocale(e.target.value as Locale)} aria-label={t('more.chooseLanguage')}>
        {locales.map((l) => (
          <option key={l} value={l}>
            {languageNames[l]}
            {isReviewed(l) ? '' : ' *'}
          </option>
        ))}
      </select>
    </label>
  );
}
