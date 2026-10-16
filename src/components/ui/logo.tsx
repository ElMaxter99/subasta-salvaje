import Link from 'next/link';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link href="/" className={`font-display text-xl uppercase tracking-tight text-white ${className}`} aria-label="Subasta Salvaje, inicio">
      <span className="text-gold">Subasta</span> <span className="text-violet-soft">Salvaje</span>
    </Link>
  );
}
