import type { ReactNode } from "react";
import { cardClass } from "./form-styles";
import { Icon, type IconName } from "./icons";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-foreground sm:text-[32px]">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${cardClass} ${className}`}>
      {title ? <h4 className="mb-3 text-foreground">{title}</h4> : null}
      {children}
    </section>
  );
}

const TONES = {
  primary: "bg-primary-soft text-sky-800",
  success: "bg-success-soft text-emerald-800",
  warning: "bg-warning-soft text-amber-800",
  danger: "bg-danger-soft text-red-800",
  locked: "bg-locked-soft text-violet-800",
  neutral: "bg-neutral-soft text-slate-700",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  icon,
  tone = "primary",
  hint,
}: {
  label: string;
  value: ReactNode;
  icon: IconName;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div className={`${cardClass} flex items-center gap-3`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`}>
        <Icon name={icon} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="text-2xl font-semibold leading-tight text-foreground">{value}</p>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}
