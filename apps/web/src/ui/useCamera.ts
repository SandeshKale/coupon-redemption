import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

export type CameraPhase = 'idle' | 'starting' | 'scanning' | 'denied' | 'error';

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/** Starts a decode loop on the video element; returns a stop function. */
async function decodeLoop(
  el: HTMLVideoElement,
  live: () => boolean,
  emit: (text: string) => void,
): Promise<() => void> {
  const Native = (window as Window & { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (Native !== undefined) {
    const detector = new Native({ formats: ['qr_code'] });
    const tick = async (): Promise<void> => {
      if (!live()) return;
      const found = await detector.detect(el).catch(() => []);
      const first = found[0];
      if (first !== undefined) emit(first.rawValue);
      window.setTimeout(() => void tick(), 150);
    };
    void tick();
    return () => undefined;
  }
  const { BrowserQRCodeReader } = await import('@zxing/browser');
  const controls = await new BrowserQRCodeReader().decodeFromVideoElement(el, (r) => {
    if (r !== undefined) emit(r.getText());
  });
  return () => {
    controls.stop();
  };
}

/**
 * Camera + QR decoding: native BarcodeDetector where available, @zxing/browser lazy-loaded
 * otherwise (EC-052). Emits each code once per 2 s, and nothing while paused.
 */
export function useCamera(
  media: Pick<MediaDevices, 'getUserMedia'> | undefined,
  onCode: (text: string) => void,
  paused: boolean,
): {
  video: RefObject<HTMLVideoElement | null>;
  phase: CameraPhase;
  start: () => Promise<void>;
  stop: () => void;
} {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const stopZxing = useRef<(() => void) | null>(null);
  const last = useRef({ text: '', at: 0 });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [phase, setPhase] = useState<CameraPhase>('idle');

  const emit = useCallback(
    (text: string) => {
      const now = Date.now();
      if (pausedRef.current || (text === last.current.text && now - last.current.at < 2000)) return;
      last.current = { text, at: now };
      onCode(text);
    },
    [onCode],
  );

  const stop = useCallback(() => {
    stopZxing.current?.();
    stopZxing.current = null;
    stream.current?.getTracks().forEach((tr) => {
      tr.stop();
    });
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    if (media === undefined) {
      setPhase('error');
      return;
    }
    setPhase('starting');
    try {
      const s = await media.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      stream.current = s;
      const el = video.current;
      if (el === null) return;
      el.srcObject = s;
      await el.play().catch(() => undefined);
      setPhase('scanning');
      stopZxing.current = await decodeLoop(el, () => stream.current !== null, emit);
    } catch (e) {
      stop();
      setPhase(
        e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
          ? 'denied'
          : 'error',
      );
    }
  }, [emit, media, stop]);

  useEffect(() => stop, [stop]);
  return { video, phase, start, stop };
}
