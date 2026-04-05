// ============================================================
// OmnirunSpinner — Branded Loading Animation
// ============================================================
// Shows the Omnirun sphere with orbiting green dot + elapsed time.
// Used in chat areas when waiting for AI response.
// CSS animation runs on compositor thread — never freezes.

import { useRef, useEffect, useState } from "react";

interface OmnirunSpinnerProps {
  /** Size in pixels (default 28) */
  size?: number;
  /** Show elapsed time counter (default true) */
  showTimer?: boolean;
  /** Text color CSS class (default: theme muted) */
  textClass?: string;
}

export default function OmnirunSpinner({
  size = 28,
  showTimer = true,
  textClass = "opacity-50",
}: OmnirunSpinnerProps) {
  const dotRef = useRef<SVGCircleElement>(null);
  const maskRef = useRef<SVGCircleElement>(null);
  const rafRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // ── Elapsed time counter ──
  useEffect(() => {
    if (!showTimer) return;
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [showTimer]);

  // ── Orbit animation ──
  useEffect(() => {
    const dot = dotRef.current;
    const mask = maskRef.current;
    if (!dot || !mask) return;

    const CX = 512, CY = 511.762;
    const ORX = 287.5, ORY = 287.2;
    const DOT_X = 745.253, DOT_Y = 344.021;
    const GAP_R_FINAL = 55.4;
    const GAP_ANGLE = Math.atan2(DOT_Y - CY, DOT_X - CX);
    const BASE_SPEED = 0.0022;
    const DEPTH = 0.18;

    let angle = GAP_ANGLE;
    let prev: number | null = null;
    let popped = false;
    let popStart: number | null = null;
    const POP_DUR = 350;

    function backOut(t: number, s = 2.5) {
      return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
    }

    // Initial state
    mask.setAttribute("r", "0");
    dot.setAttribute("cx", String(DOT_X));
    dot.setAttribute("cy", String(DOT_Y));
    dot.style.opacity = "0";
    dot.style.transform = "scale(0)";
    dot.style.transformOrigin = `${DOT_X}px ${DOT_Y}px`;

    function tick(ts: number) {
      if (prev === null) prev = ts;
      const dt = ts - prev;
      prev = ts;

      if (!popped) {
        if (popStart === null) popStart = ts;
        const p = Math.min((ts - popStart) / POP_DUR, 1);
        const s = Math.max(backOut(p), 0);
        dot.style.opacity = String(Math.min(p * 3, 1));
        dot.style.transform = `scale(${s})`;
        mask.setAttribute("r", (GAP_R_FINAL * Math.min(p * 1.5, 1)).toFixed(2));
        if (p >= 1) {
          popped = true;
          dot.style.opacity = "1";
          dot.style.transform = "scale(1)";
          mask.setAttribute("r", String(GAP_R_FINAL));
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const offset = angle - GAP_ANGLE;
      const speed = BASE_SPEED * (1 + DEPTH * Math.cos(offset));
      angle += speed * dt;

      const x = (CX + ORX * Math.cos(angle)).toFixed(3);
      const y = (CY + ORY * Math.sin(angle)).toFixed(3);
      dot.setAttribute("cx", x);
      dot.setAttribute("cy", y);
      mask.setAttribute("cx", x);
      mask.setAttribute("cy", y);

      rafRef.current = requestAnimationFrame(tick);
    }

    const timeout = setTimeout(() => {
      rafRef.current = requestAnimationFrame(tick);
    }, 100);

    return () => {
      clearTimeout(timeout);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const formatTime = (s: number) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  return (
    <span className="inline-flex items-center gap-2">
      <svg
        viewBox="0 0 1024 1024"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ overflow: "visible" }}
      >
        <defs>
          <linearGradient id="os-rg" x1="345.699" y1="806.207" x2="710.131" y2="269.23" gradientUnits="userSpaceOnUse">
            <stop stopColor="#D1D5DB" />
            <stop offset="1" stopColor="#8B919A" />
          </linearGradient>
          <radialGradient id="os-dg" cx="38%" cy="30%" r="65%">
            <stop stopColor="#5DE8A0" />
            <stop offset="1" stopColor="#2DB87A" />
          </radialGradient>
          <filter id="os-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="18" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="os-fade-top" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.20" stopColor="white" stopOpacity="1" />
            <stop offset="0.80" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="os-fade-bot" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.20" stopColor="white" stopOpacity="0" />
            <stop offset="0.80" stopColor="white" stopOpacity="1" />
          </linearGradient>
          <mask id="os-mask-top">
            <rect x="0" y="0" width="1024" height="1024" fill="url(#os-fade-top)" />
            <circle ref={maskRef} cx="745.253" cy="344.021" r="0" fill="black" />
          </mask>
          <mask id="os-mask-bot">
            <rect x="0" y="0" width="1024" height="1024" fill="url(#os-fade-bot)" />
          </mask>
        </defs>

        {/* Ring back half */}
        <path
          d="M512 177C703.643 177 859 326.878 859 511.762C859 696.645 703.643 846.522 512 846.522C320.357 846.522 165 696.645 165 511.762C165 326.878 320.357 177 512 177Z M823 493.5A298.5 286.5 0 1 1 226 493.5A298.5 286.5 0 1 1 823 493.5Z"
          fillRule="evenodd"
          fill="url(#os-rg)"
          mask="url(#os-mask-top)"
        />

        {/* Orbiting dot */}
        <circle
          ref={dotRef}
          cx="745.253"
          cy="344.021"
          r="40.3154"
          fill="url(#os-dg)"
          filter="url(#os-glow)"
        />

        {/* Ring front half */}
        <path
          d="M512 177C703.643 177 859 326.878 859 511.762C859 696.645 703.643 846.522 512 846.522C320.357 846.522 165 696.645 165 511.762C165 326.878 320.357 177 512 177Z M823 493.5A298.5 286.5 0 1 1 226 493.5A298.5 286.5 0 1 1 823 493.5Z"
          fillRule="evenodd"
          fill="url(#os-rg)"
          mask="url(#os-mask-bot)"
        />
      </svg>

      {showTimer && elapsed > 0 && (
        <span className={`text-[11px] font-mono ${textClass}`}>
          {elapsed < 5 ? "Generating..." : `Generating... ${formatTime(elapsed)}`}
        </span>
      )}
    </span>
  );
}