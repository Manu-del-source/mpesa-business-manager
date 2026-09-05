import React from "react";

/**
 * Page-level title block for OMNI console pages. Uses the OMNI design
 * tokens (see DESIGN.md) — kept separate from the legacy `PageHeader` in
 * `components/layout/page-header.tsx`, which targets the older
 * business-manager shadcn theme and would look inconsistent here.
 */
export function OmniPageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div>
        <h1 className="text-headline-md font-headline-md text-primary font-bold tracking-tight mb-1">
          {title}
        </h1>
        {description && (
          <p className="text-body-md font-body-md text-on-surface-variant">{description}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}
