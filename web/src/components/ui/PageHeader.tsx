/**
 * Standardized page header. Used by every top-level page so titles,
 * subtitles, and the optional right-side actions slot align across
 * the workspace and don't drift in spacing or font size.
 *
 *   <PageHeader title="Issues" subtitle="Everything in flight" actions={<NewBtn/>} />
 *
 * Sized for "data-page" headers (issues, agents, projects, etc.).
 * The home composer + onboarding pages use a more editorial hero;
 * those don't use this component.
 */
interface Props {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Slot rendered on the right edge: usually a primary button or filter group. */
  actions?: React.ReactNode;
  /** Eyebrow label rendered above the title in tight uppercase. */
  eyebrow?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions, eyebrow }: Props) {
  return (
    <header className="flex items-end justify-between gap-6 px-8 py-5 border-b border-gray-200 bg-white">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500 font-semibold mb-1">
            {eyebrow}
          </p>
        )}
        <h1 className="text-[20px] font-semibold tracking-tight text-gray-900 leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[13px] text-gray-500 mt-1 leading-snug">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}
