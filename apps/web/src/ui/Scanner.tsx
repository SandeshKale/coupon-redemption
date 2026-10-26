import { type ReactNode, useEffect } from 'react';

import { type Key, useI18n } from '../lib/i18n/index.ts';

import { Button } from './Button.tsx';
import { type CameraPhase, useCamera } from './useCamera.ts';

export interface ScannerProps {
  readonly onCode: (text: string) => void;
  readonly onClose: () => void;
  readonly paused?: boolean;
  /** Camera API (injected in tests). */
  readonly media?: Pick<MediaDevices, 'getUserMedia'> | undefined;
}

const MESSAGE: Record<Exclude<CameraPhase, 'scanning'>, Key> = {
  idle: 'scanner.permission',
  starting: 'scanner.starting',
  denied: 'scanner.denied',
  error: 'scanner.denied',
};

/** Explains the camera permission first; denial falls back to typing (EC-051). Esc closes (2.1.2). */
export function Scanner({
  onCode,
  onClose,
  paused = false,
  media = (navigator as Partial<Navigator>).mediaDevices,
}: ScannerProps): ReactNode {
  const { t } = useI18n();
  const { video, phase, start, stop } = useCamera(media, onCode, paused);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        stop();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, stop]);
  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-card bg-ink">
        <video
          ref={video}
          muted
          playsInline
          className={`h-full w-full object-cover ${phase === 'scanning' ? '' : 'hidden'}`}
          aria-label={t('scanner.aim')}
        />
        {phase === 'scanning' ? null : (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center p-6 text-center text-white"
          >
            {t(MESSAGE[phase])}
          </p>
        )}
      </div>
      {phase === 'idle' ? (
        <Button size="lg" onClick={() => void start()}>
          {t('scanner.start')}
        </Button>
      ) : null}
      <Button
        variant="secondary"
        onClick={() => {
          stop();
          onClose();
        }}
      >
        {t('scanner.close')}
      </Button>
    </div>
  );
}
