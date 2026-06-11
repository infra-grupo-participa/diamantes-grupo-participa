export default function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <div className="brand">
      <span className="brand-logo" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M6 3h12l4 6-10 12L2 9l4-6z" fill="#fff" opacity="0.95" />
          <path d="M6 3h12l4 6H2l4-6z" fill="#fff" opacity="0.7" />
        </svg>
      </span>
      <span className="brand-text">
        Diamantes
        {subtitle && <small>{subtitle}</small>}
      </span>
    </div>
  );
}
