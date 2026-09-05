import React from "react";

export function OmniEmptyState({
  icon = "inbox",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
      <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant">
        <span className="material-symbols-outlined text-[24px]">{icon}</span>
      </div>
      <div className="space-y-1">
        <h3 className="text-body-md font-body-md font-semibold text-primary">{title}</h3>
        {description && (
          <p className="text-body-sm font-body-sm text-on-surface-variant max-w-sm mx-auto">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Inline error banner with retry — matches the pattern used on the dashboard. */
export function OmniErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[20px]">error</span>
        <span className="text-body-sm">{message}</span>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="text-body-sm underline font-semibold hover:text-red-900 shrink-0">
          Retry
        </button>
      )}
    </div>
  );
}
