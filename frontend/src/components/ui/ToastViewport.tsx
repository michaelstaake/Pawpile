import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "../../context/ToastContext";

const TOAST_STYLES = {
  success: {
    iconClassName: "bi bi-check-circle-fill",
    cardClassName: "border-emerald-200 bg-emerald-50/95 text-emerald-900",
    iconClassNames: "text-emerald-600",
    closeClassName: "text-emerald-700/80 hover:bg-emerald-100 hover:text-emerald-900",
  },
  error: {
    iconClassName: "bi bi-exclamation-octagon-fill",
    cardClassName: "border-rose-200 bg-rose-50/95 text-rose-900",
    iconClassNames: "text-rose-600",
    closeClassName: "text-rose-700/80 hover:bg-rose-100 hover:text-rose-900",
  },
} as const;

export default function ToastViewport() {
  const { dismissToast, toasts } = useToast();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-x-3 top-3 z-[120] flex flex-col gap-3 sm:left-auto sm:right-4 sm:w-full sm:max-w-md">
      {toasts.map((toast) => {
        const style = TOAST_STYLES[toast.kind];

        return (
          <section
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
            aria-live={toast.kind === "error" ? "assertive" : "polite"}
            className={`pointer-events-auto rounded-2xl border p-4 shadow-lg shadow-black/10 backdrop-blur transition duration-200 animate-[toast-in_180ms_ease-out] ${style.cardClassName}`}
          >
            <div className="flex items-start gap-3">
              <i className={`${style.iconClassName} mt-0.5 text-base leading-none ${style.iconClassNames}`} aria-hidden="true" />
              <p className="min-w-0 flex-1 text-sm leading-6">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${style.closeClassName}`}
                aria-label="Dismiss notification"
              >
                <i className="bi bi-x-lg text-xs leading-none" aria-hidden="true" />
              </button>
            </div>
          </section>
        );
      })}
    </div>,
    document.body
  );
}