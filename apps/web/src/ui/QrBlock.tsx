import qrcode from 'qrcode-generator';
import { type ReactNode, useMemo } from 'react';

/** QR rendered locally as SVG rects (no network, no innerHTML), with the text alternative (1.1.1). */
export function QrSvg({
  value,
  label,
  size = 232,
  ecc = 'Q',
}: {
  readonly value: string;
  readonly label: string;
  readonly size?: number;
  readonly ecc?: 'L' | 'M' | 'Q' | 'H';
}): ReactNode {
  const { cells, count } = useMemo(() => {
    const qr = qrcode(0, ecc);
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const out: [number, number][] = [];
    for (let r = 0; r < n; r += 1)
      for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) out.push([c, r]);
    return { cells: out, count: n };
  }, [value, ecc]);
  const quiet = 4;
  const dim = count + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="bg-white"
    >
      <rect width={dim} height={dim} fill="#fff" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width={1} height={1} fill="#000" />
      ))}
    </svg>
  );
}
