import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const variants: Record<Variant, string> = {
  primary: 'bg-gold text-night-950 hover:bg-gold-soft shadow-[0_6px_0_#b45309] active:shadow-none active:translate-y-[5px]',
  secondary: 'bg-night-700 text-white hover:bg-night-600 border border-white/10',
  danger: 'bg-rose text-night-950 hover:brightness-110',
  success: 'bg-teal text-night-950 hover:brightness-110',
  ghost: 'bg-transparent text-white/80 hover:bg-white/10',
};
const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm min-h-9 rounded-lg',
  md: 'px-4 py-2.5 text-base min-h-11 rounded-xl',
  lg: 'px-5 py-3.5 text-lg min-h-14 rounded-2xl',
  xl: 'px-6 py-4 text-xl min-h-16 rounded-2xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', loading, className = '', disabled, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 font-bold transition select-none disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
      {children}
    </button>
  );
}
