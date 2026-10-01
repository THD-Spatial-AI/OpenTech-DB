/**
 * StudioTour.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * A lightweight guided tour for the Process Studio: a dimmed backdrop with a
 * spotlight cut-out + pulsing ring over each target region, and a coachmark card
 * explaining what you can edit there. Generic across H₂, CCUS, and any future
 * process — steps point at stable Studio regions, not specific equipment.
 *
 * Steps: [{ selector: '[data-tour="…"]', title, body }]. Missing targets are
 * skipped gracefully (the card centres itself).
 */

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiArrowRight, FiArrowLeft } from 'react-icons/fi';

const TIP_W = 300;
const PAD = 8;

export default function StudioTour({ steps, onClose }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const step = steps[i];

  const measure = useCallback(() => {
    const el = step?.selector ? document.querySelector(step.selector) : null;
    if (el) {
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      setRect(el.getBoundingClientRect());
    } else {
      setRect(null);
    }
  }, [step]);

  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    const id = setInterval(measure, 400);           // keep the spotlight glued during layout shifts
    window.addEventListener('resize', measure);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(id); window.removeEventListener('resize', measure); window.removeEventListener('keydown', onKey); };
  }, [measure, onClose]);

  const next = () => (i < steps.length - 1 ? setI(i + 1) : onClose());
  const back = () => setI(Math.max(0, i - 1));

  const hole = rect
    ? { x: rect.left - PAD, y: rect.top - PAD, w: rect.width + 2 * PAD, h: rect.height + 2 * PAD }
    : null;

  const vw = window.innerWidth, vh = window.innerHeight;
  let tip = { top: vh / 2 - 80, left: vw / 2 - TIP_W / 2 };
  if (hole) {
    const placeBelow = hole.y + hole.h + 180 < vh;
    tip = {
      top: placeBelow ? hole.y + hole.h + 12 : Math.max(12, hole.y - 168),
      left: Math.min(Math.max(12, hole.x + hole.w / 2 - TIP_W / 2), vw - TIP_W - 12),
    };
  }

  return createPortal(
    <div className="fixed inset-0 z-[100000]">
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        <defs>
          <mask id="studio-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="14" fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(15,17,26,0.60)" mask="url(#studio-tour-mask)" />
        {hole && (
          <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="14"
                fill="none" stroke="#4d4b9e" strokeWidth="2.5" className="animate-pulse" />
        )}
      </svg>

      {/* click anywhere (outside the card) advances */}
      <div className="absolute inset-0" onClick={next} />

      <div
        className="absolute rounded-xl bg-surface-container-lowest shadow-2xl border border-outline-variant/30 p-4"
        style={{ top: tip.top, left: tip.left, width: TIP_W }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className="w-6 h-6 rounded-full bg-primary text-on-primary text-xs font-bold flex items-center justify-center shrink-0">
            {i + 1}
          </span>
          <h4 className="font-headline text-sm font-bold text-on-surface">{step.title}</h4>
          <button onClick={onClose} title="Skip tour" className="ml-auto text-on-surface-variant hover:text-on-surface">
            <FiX size={15} />
          </button>
        </div>
        <p className="text-xs text-on-surface-variant leading-relaxed mb-3">{step.body}</p>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {steps.map((_, k) => (
              <span key={k} className={`w-1.5 h-1.5 rounded-full ${k === i ? 'bg-primary' : 'bg-outline-variant/50'}`} />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {i > 0 && (
              <button onClick={back} className="text-xs text-on-surface-variant hover:text-on-surface flex items-center gap-1">
                <FiArrowLeft size={12} /> Back
              </button>
            )}
            <button onClick={next}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold technical-gradient text-on-primary">
              {i < steps.length - 1 ? <>Next <FiArrowRight size={12} /></> : 'Done'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
