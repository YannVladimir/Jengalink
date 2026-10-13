import { MAX_UPDATE_PHOTOS, type PhotoContentType, type ProjectStage } from '@jengalink/contracts';
import { useI18n } from '@jengalink/i18n/react';
import { Button, StateView, Text } from '@jengalink/ui/web';
import { Camera, Check, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const newKey = () => `upd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Site update from the web (same rules as the phone): stage, photos, note, blocker. */
export default function NewUpdatePage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const navigate = useNavigate();
  const uid = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const sendKey = useRef(newKey());

  const [stages, setStages] = useState<ProjectStage[] | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [note, setNote] = useState('');
  const [blocker, setBlocker] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let live = true;
    withRefresh(() => request(() => api.GET('/v1/projects/{id}/stages', { params: { path: { id } } })))
      .then((list) => {
        if (!live) return;
        setStages(list);
        const open = list.filter((s) => s.status !== 'accepted');
        setStageId((open.find((s) => s.status === 'in_progress') ?? open[0] ?? list[0])?.id ?? null);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, withRefresh]);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const picked = [...files].filter((f) => PHOTO_TYPES.includes(f.type)).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPhotos((ps) => [...ps, ...picked].slice(0, MAX_UPDATE_PHOTOS));
  };

  const send = async () => {
    if (!stageId) return;
    setError(null);
    try {
      const uploaded: { uploadKey: string; capturedAt: null }[] = [];
      for (const [i, p] of photos.entries()) {
        setProgress(t('composer.uploading', { n: i + 1, total: photos.length }));
        const grant = await withRefresh(() =>
          request(() => api.POST('/v1/projects/{id}/uploads', { params: { path: { id } }, body: { contentType: p.file.type as PhotoContentType } })),
        );
        const put = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: p.file });
        if (!put.ok) throw new Error('upload');
        // Browsers do not expose when a photo was taken without reading EXIF; left empty rather than guessed.
        uploaded.push({ uploadKey: grant.key, capturedAt: null });
      }
      setProgress(t('composer.sending'));
      await withRefresh(() =>
        request(() =>
          api.POST('/v1/projects/{id}/updates', {
            params: { path: { id }, header: { 'Idempotency-Key': sendKey.current } },
            body: {
              stageId,
              ...(note.trim() ? { note: note.trim() } : {}),
              ...(blocker.trim() ? { blockers: blocker.trim() } : {}),
              photos: uploaded,
            },
          }),
        ),
      );
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('composer.photoFailed'));
    } finally {
      setProgress(null);
    }
  };

  if (failed) return <div className="ws-page"><StateView kind="error" title={t('common.somethingWrong')} /></div>;
  if (!stages) return null;

  if (sent)
    return (
      <div className="ws-page wz">
        <div className="wz-done">
          <span className="wz-done__icon" aria-hidden>
            <Check size={32} />
          </span>
          <Text variant="screenTitle" as="h1">
            {t('composer.sentTitle')}
          </Text>
          <Text muted>{t('composer.sentLead')}</Text>
          <div className="iv-share">
            <Button size="lg" onClick={() => navigate('/projects')}>
              {t('wizard.doneButton')}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => {
                sendKey.current = newKey();
                setPhotos([]);
                setNote('');
                setBlocker('');
                setSent(false);
              }}
            >
              {t('composer.addAnother')}
            </Button>
          </div>
        </div>
      </div>
    );

  const busy = progress !== null;
  const canSend = !!stageId && (photos.length > 0 || note.trim().length >= 3) && !busy;
  const shown = stages.some((s) => s.status !== 'accepted') ? stages.filter((s) => s.status !== 'accepted') : stages;

  return (
    <div className="ws-page wz">
      <header className="ws-head">
        <Text variant="screenTitle" as="h1">
          {t('nav.newUpdate')}
        </Text>
      </header>
      <form
        className="jl-card wz-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) void send();
        }}
      >
        <fieldset className="up-chips">
          <legend className="jl-field__label">{t('composer.whichStage')}</legend>
          {shown.map((s) => (
            <label key={s.id} className={s.id === stageId ? 'is-on' : undefined}>
              <input type="radio" name="stage" checked={s.id === stageId} onChange={() => setStageId(s.id)} />
              {s.name}
            </label>
          ))}
        </fieldset>

        <div className="jl-field">
          <span className="jl-field__label">{t('composer.photos', { count: photos.length })}</span>
          <div className="up-photos">
            {photos.map((p, i) => (
              <div key={p.url} className="up-photo">
                <img src={p.url} alt="" />
                <button type="button" aria-label={t('composer.removePhoto', { n: i + 1 })} onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>
                  <X size={16} aria-hidden />
                </button>
              </div>
            ))}
            {photos.length < MAX_UPDATE_PHOTOS && (
              <button type="button" className="up-add" onClick={() => fileInput.current?.click()}>
                <Camera size={26} aria-hidden />
                {t('composer.takePhoto')}
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            capture="environment"
            multiple
            hidden
            aria-label={t('composer.takePhoto')}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <span className="jl-field__hint">{t('composer.maxPhotos', { max: MAX_UPDATE_PHOTOS })}</span>
        </div>

        <div className="jl-field">
          <label className="jl-field__label" htmlFor={`${uid}-note`}>
            {t('composer.whatHappened')}
          </label>
          <textarea id={`${uid}-note`} className="pl-textarea" rows={3} maxLength={500} value={note} placeholder={t('composer.whatHappenedPlaceholder')} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="jl-field">
          <label className="jl-field__label" htmlFor={`${uid}-block`}>
            {t('composer.blocking')}
          </label>
          <span className="si-input pl-input">
            <input id={`${uid}-block`} maxLength={300} value={blocker} placeholder={t('composer.blockingPlaceholder')} onChange={(e) => setBlocker(e.target.value)} />
          </span>
        </div>

        {error && (
          <p className="jl-field__error" role="alert">
            {error}
          </p>
        )}
        <div className="wz-actions">
          <span className="jl-field__hint">{!canSend && !busy ? t('composer.needPhotoOrNote') : ''}</span>
          <Button type="submit" size="lg" loading={busy} disabled={!canSend}>
            {progress ?? (photos.length ? t('composer.sendWithPhotos', { count: photos.length }) : t('composer.send'))}
          </Button>
        </div>
      </form>
    </div>
  );
}
