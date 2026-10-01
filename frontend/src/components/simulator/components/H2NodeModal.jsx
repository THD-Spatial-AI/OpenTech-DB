/**
 * H2NodeModal.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Full-screen modal panel for H₂ plant node detail / analysis.
 * Rendered via ReactDOM.createPortal → document.body, so it always sits on top
 * of React Flow regardless of stacking context or z-index.
 *
 * Props:
 *   open        {boolean}    – controls visibility
 *   onClose     {Function}   – called when backdrop/X/Escape is triggered
 *   title       {string}
 *   subtitle    {string}
 *   icon        {ReactNode}  – icon at the left of the title bar
 *   accentColor {string}     – Tailwind bg color class, e.g. "bg-amber-500"
 *   children    {ReactNode}
 */

import React, { useEffect, useCallback } from "react";
import ReactDOM from "react-dom";

export default function H2NodeModal({ open, onClose, title, subtitle, icon, accentColor = "bg-primary", children }) {
  // ── Close on Escape key ──────────────────────────────────────────────────
  const handleKey = useCallback(
    (e) => { if (e.key === "Escape") onClose(); },
    [onClose]
  );
  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKey);
    // Prevent background scroll while modal is open
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [open, handleKey]);

  if (!open) return null;

  return ReactDOM.createPortal(
    <>
      {/* ── Backdrop ──────────────────────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-[2px]"
        style={{ animation: "h2-fade-in 0.18s ease" }}
        onClick={onClose}
        aria-hidden
      />

      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-y-0 right-0 z-[9999] flex flex-col
          w-full max-w-4xl
          bg-surface-container-lowest shadow-2xl
          overflow-hidden"
        style={{ animation: "h2-slide-in 0.28s cubic-bezier(0.22,1,0.36,1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Title bar ───────────────────────────────────────────────────── */}
        <div className={`flex items-center gap-3 px-6 py-4 ${accentColor} text-white shrink-0`}>
          {icon && (
            <span className="p-2 rounded-xl bg-surface-container-lowest/20">{icon}</span>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold leading-tight truncate">{title}</h2>
            {subtitle && (
              <p className="text-xs text-white/75 mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg
              bg-surface-container-lowest/15 hover:bg-surface-container-lowest/30 transition-colors text-white text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6 bg-surface-container">
          {children}
        </div>
      </div>

      {/* ── Keyframe animations (injected once) ───────────────────────────── */}
      <style>{`
        @keyframes h2-fade-in  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes h2-slide-in { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>
    </>,
    document.body
  );
}
