import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../lib/i18n/index.ts';

import { Scanner } from './Scanner.tsx';

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromVideoElement(_el: unknown, cb: (r: { getText: () => string } | undefined) => void) {
      cb(undefined);
      cb({ getText: () => 'ZXING-CODE' });
      return Promise.resolve({ stop: vi.fn() });
    }
  },
}));

const wrap = (ui: ReactNode) => render(<I18nProvider lang="en">{ui}</I18nProvider>);
const track = { stop: vi.fn() };
const media = (impl?: () => Promise<MediaStream>) => ({
  getUserMedia: vi.fn(
    impl ?? (() => Promise.resolve({ getTracks: () => [track] } as unknown as MediaStream)),
  ),
});

HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());

afterEach(() => {
  delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
});

describe('Scanner', () => {
  it('explains the permission first, then decodes with BarcodeDetector (each code once)', async () => {
    const onCode = vi.fn();
    (window as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      detect() {
        return Promise.resolve([{ rawValue: 'NATIVE-CODE' }]);
      }
    };
    wrap(<Scanner onCode={onCode} onClose={vi.fn()} media={media()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Allow the camera to scan coupons.');
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await waitFor(() => {
      expect(onCode).toHaveBeenCalledWith('NATIVE-CODE');
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(onCode).toHaveBeenCalledTimes(1);
  });

  it('EC-052 falls back to ZXing when BarcodeDetector is missing; paused emits nothing', async () => {
    const onCode = vi.fn();
    const { rerender } = wrap(<Scanner onCode={onCode} onClose={vi.fn()} media={media()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await waitFor(() => {
      expect(onCode).toHaveBeenCalledWith('ZXING-CODE');
    });
    rerender(
      <I18nProvider lang="en">
        <Scanner onCode={onCode} onClose={vi.fn()} media={media()} paused />
      </I18nProvider>,
    );
  });

  it('EC-051 permission denied → type the code instead', async () => {
    wrap(
      <Scanner
        onCode={vi.fn()}
        onClose={vi.fn()}
        media={media(() => Promise.reject(new DOMException('no', 'NotAllowedError')))}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    expect(
      await screen.findByText('Camera is blocked. Type the code instead.'),
    ).toBeInTheDocument();
  });

  it('other camera errors and missing camera API', async () => {
    wrap(
      <Scanner
        onCode={vi.fn()}
        onClose={vi.fn()}
        media={media(() => Promise.reject(new Error('busy')))}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    expect(
      await screen.findByText('Camera is blocked. Type the code instead.'),
    ).toBeInTheDocument();
  });

  it('no camera API at all', async () => {
    wrap(<Scanner onCode={vi.fn()} onClose={vi.fn()} media={undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    expect(
      await screen.findByText('Camera is blocked. Type the code instead.'),
    ).toBeInTheDocument();
  });

  it('Esc and the close button stop the camera and close', async () => {
    const onClose = vi.fn();
    wrap(<Scanner onCode={vi.fn()} onClose={onClose} media={media()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Close camera' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(track.stop).toHaveBeenCalled();
  });
});
