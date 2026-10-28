import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'danger' | 'ghost' | 'subtle' | 'outline' | 'success';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-gold text-[#1a1406] font-semibold hover:bg-gold-2 border border-gold-2/40 shadow-[0_0_0_1px_rgb(227_179_65/0.2),0_8px_24px_-8px_rgb(227_179_65/0.5)]',
  success: 'bg-emerald/15 text-emerald border border-emerald/40 hover:bg-emerald/25 font-medium',
  danger: 'bg-red/10 text-red border border-red/35 hover:bg-red/20 font-medium',
  ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-raised hover:text-ink',
  subtle: 'bg-raised text-ink border border-line hover:border-line-strong hover:bg-[#1b2431]',
  outline: 'bg-transparent text-ink-2 border border-line hover:border-line-strong hover:text-ink',
};

const sizes: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-[11.5px] rounded-md gap-1',
  sm: 'h-7 px-2.5 text-[12.5px] rounded-md gap-1.5',
  md: 'h-8 px-3 text-[13px] rounded-md gap-2',
  lg: 'h-10 px-4 text-[14px] rounded-lg gap-2',
};

export const buttonClass = (variant: ButtonVariant = 'subtle', size: ButtonSize = 'md', extra = '') =>
  `inline-flex items-center justify-center whitespace-nowrap select-none transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${extra}`;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'subtle', size = 'md', loading, icon, children, className = '', disabled, ...rest }: ButtonProps) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  variant = 'subtle',
  size = 'md',
  icon,
  children,
  className = '',
  external,
  download,
  title,
  onClick,
}: {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  external?: boolean;
  download?: boolean;
  title?: string;
  onClick?: (e: MouseEvent) => void;
}) {
  if (external || download) {
    return (
      <a
        href={to}
        className={buttonClass(variant, size, className)}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer' : undefined}
        download={download}
        title={title}
        onClick={onClick}
      >
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={buttonClass(variant, size, className)} title={title} onClick={onClick}>
      {icon}
      {children}
    </Link>
  );
}
