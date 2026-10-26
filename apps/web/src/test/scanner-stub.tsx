import type { ReactNode } from 'react';

/** Test double for the camera: buttons that "scan" a given text. */
export const scanned: string[] = [];
export function ScannerStub({
  onCode,
  onClose,
}: {
  onCode: (t: string) => void;
  onClose: () => void;
}): ReactNode {
  return (
    <div>
      {scanned.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => {
            onCode(s);
          }}
        >
          {`scan ${s}`}
        </button>
      ))}
      <button type="button" onClick={onClose}>
        {'close scanner'}
      </button>
    </div>
  );
}
