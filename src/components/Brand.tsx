import { classNames } from '../lib/utils';

export function ClipCanvasMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="ClipCanvas"
      className={classNames('clipcanvas-mark', className)}
    >
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M10 8.5h12v15.2a.8.8 0 0 1-1.24.67L16 20.84l-4.76 3.53A.8.8 0 0 1 10 23.7V8.5Z"
        fill="#fbfaf6"
      />
      <path d="M13.2 12.4h5.6M13.2 15.4h5.6" stroke="#256d5b" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={classNames('brand', compact && 'brand-compact')}>
      <ClipCanvasMark size={compact ? 24 : 28} />
      {!compact ? (
        <div className="brand-copy">
          <span className="brand-name">ClipCanvas</span>
          <span className="brand-tagline">Research notebook</span>
        </div>
      ) : null}
    </div>
  );
}
