import { photoTime, type SiteUpdate, type UpdatePhoto } from '@jengalink/contracts';
import { formatDate, formatDateTime, formatUpdatedAgo, type Translate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { ChevronLeft, ChevronRight, ChevronsLeftRight, ImageOff, Loader, ShieldAlert, TriangleAlert, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';

const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);

function takenLine(p: UpdatePhoto, t: Translate, locale: Parameters<typeof formatDateTime>[0]) {
  if (!p.capturedAt) return t('feed.takenUnknown');
  const time = formatDateTime(locale, p.capturedAt);
  return t(p.capturedAtSource === 'exif' ? 'feed.takenExif' : p.capturedAtSource === 'device' ? 'feed.takenDevice' : 'feed.taken', { time });
}

function PhotoThumb({ photo, onOpen, large }: { photo: UpdatePhoto; onOpen: () => void; large: boolean }) {
  const { t } = useI18n();
  if (photo.status === 'ready' && photo.thumbUrl)
    return (
      <button type="button" className={`fd-thumb${large ? ' is-large' : ''}`} onClick={onOpen} aria-label={t('feed.openOriginal')}>
        <img src={photo.thumbUrl} alt="" loading="lazy" />
      </button>
    );
  const [Icon, label, cls] =
    photo.status === 'processing'
      ? [Loader, t('feed.photoProcessing'), '']
      : photo.status === 'blocked'
        ? [ShieldAlert, t('feed.photoBlocked'), ' is-problem']
        : [ImageOff, t('feed.photoFailed'), ''];
  return (
    <span className={`fd-thumb fd-thumb--placeholder${cls}`} role="img" aria-label={label}>
      <Icon size={20} aria-hidden />
      <small>{label}</small>
    </span>
  );
}

/** A site update: who, when, which stage, note, blocker, photos. */
export function FeedCard({ update: u, stageLink }: { update: SiteUpdate; stageLink?: string }) {
  const { t, locale } = useI18n();
  const [viewing, setViewing] = useState<number | null>(null);
  return (
    <article className="jl-card fd-card">
      <header>
        <strong>{u.authorName ?? t('invite.someone')}</strong>
        <span>{t('feed.sentAgo', { when: formatUpdatedAgo(t, locale, u.submittedAt) })}</span>
      </header>
      <p className="fd-meta">
        {stageLink ? (
          <Link className="fd-stage" to={stageLink} title={t('feed.viewStage')}>
            {u.stageName}
          </Link>
        ) : (
          <span className="fd-stage">{u.stageName}</span>
        )}
        <span>{t('feed.workOn', { date: formatDate(locale, fromIsoDate(u.eventDate)) })}</span>
      </p>
      {u.note && <p className="fd-note">{u.note}</p>}
      {u.blockers && (
        <p className="fd-blocker">
          <TriangleAlert size={16} aria-hidden /> {t('feed.blocker', { text: u.blockers })}
        </p>
      )}
      {u.photos.length > 0 && (
        <div className="fd-photos">
          {u.photos.map((p, i) => (
            <PhotoThumb key={p.id} photo={p} large={u.photos.length === 1} onOpen={() => setViewing(i)} />
          ))}
        </div>
      )}
      <Lightbox photos={u.photos} index={viewing} onIndex={setViewing} />
    </article>
  );
}

/** Photo viewer dialog with capture and upload times. */
export function Lightbox({ photos, index, onIndex }: { photos: UpdatePhoto[]; index: number | null; onIndex: (i: number | null) => void }) {
  const { t, locale } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const ready = photos.filter((p) => p.status === 'ready');
  const current = index === null ? null : photos[index];
  const pos = current ? ready.indexOf(current) : -1;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (current && !d.open) d.showModal();
    if (!current && d.open) d.close();
  }, [current]);
  const go = (by: number) => {
    const next = ready[pos + by];
    if (next) onIndex(photos.indexOf(next));
  };
  return (
    <dialog ref={ref} className="fd-lightbox" onClose={() => onIndex(null)} aria-label={t('feed.photoOf', { n: pos + 1, total: ready.length })}>
      {current?.url && (
        <>
          <div className="fd-lightbox__bar">
            <span>{t('feed.photoOf', { n: pos + 1, total: ready.length })}</span>
            <button type="button" onClick={() => onIndex(null)} aria-label={t('plan.close')}>
              <X size={22} aria-hidden />
            </button>
          </div>
          <img src={current.url} alt="" />
          <div className="fd-lightbox__info">
            <div>
              <p>{takenLine(current, t, locale)}</p>
              <small>{t('feed.sent', { time: formatDateTime(locale, current.uploadedAt) })}</small>
            </div>
            <div className="fd-lightbox__nav">
              <button type="button" disabled={pos <= 0} onClick={() => go(-1)} aria-label={t('feed.previous')}>
                <ChevronLeft size={22} aria-hidden />
              </button>
              <a href={current.url} target="_blank" rel="noreferrer">
                {t('feed.openOriginal')}
              </a>
              <button type="button" disabled={pos >= ready.length - 1} onClick={() => go(1)} aria-label={t('feed.next')}>
                <ChevronRight size={22} aria-hidden />
              </button>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}

/** Before/after: the later photo is clipped at the slider; a real range input drives it (keyboard and screen readers). */
export function BeforeAfter({ before, after }: { before: UpdatePhoto; after: UpdatePhoto }) {
  const { t, locale } = useI18n();
  const id = useId();
  const [split, setSplit] = useState(50);
  const src = (p: UpdatePhoto) => p.url ?? p.thumbUrl ?? '';
  return (
    <figure className="fd-ba">
      <div className="fd-ba__frame">
        <img src={src(before)} alt="" />
        <img src={src(after)} alt="" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
        <span className="fd-ba__tag is-left">
          {t('feed.after')} · {formatDate(locale, photoTime(after))}
        </span>
        <span className="fd-ba__tag is-right">
          {t('feed.before')} · {formatDate(locale, photoTime(before))}
        </span>
        <span className="fd-ba__line" style={{ left: `${split}%` }} aria-hidden>
          <span>
            <ChevronsLeftRight size={18} />
          </span>
        </span>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          aria-label={t('feed.compareLabel', { percent: split })}
        />
      </div>
      <figcaption>{t('feed.dragToCompare')}</figcaption>
    </figure>
  );
}
