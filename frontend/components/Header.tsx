"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type Step = 1 | 2 | 3;

// Derives which step of the "Pick a table → Choose rules → See results"
// journey the user is currently on, purely from the URL, so it works across
// full page loads and back/forward navigation without needing shared state.
function useCurrentStep(): Step {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!pathname || pathname === "/") return 1;
  if (pathname.startsWith("/tables/")) {
    const tab = searchParams.get("tab");
    return tab === "results" ? 3 : 2;
  }
  return 1;
}

const STEPS: { step: Step; label: string }[] = [
  { step: 1, label: "Pick a table" },
  { step: 2, label: "Choose rules" },
  { step: 3, label: "See results" },
];

export function HeaderSteps() {
  const current = useCurrentStep();

  return (
    <nav className="hidden items-center gap-1.5 text-xs font-medium sm:flex" aria-label="Progress">
      {STEPS.map(({ step, label }, i) => (
        <span key={step} className="flex items-center gap-1.5">
          <span
            className={`rounded-full px-2.5 py-1 transition-colors ${
              step === current
                ? "bg-blue-600 text-white"
                : step < current
                ? "bg-blue-50 text-blue-600"
                : "bg-slate-100 text-slate-400"
            }`}
          >
            {step}. {label}
          </span>
          {i < STEPS.length - 1 && <span className="text-slate-300">→</span>}
        </span>
      ))}
    </nav>
  );
}

export function HeaderLogo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 shadow-sm transition-transform group-hover:scale-105 group-active:scale-95">
        {/* Shield + checkmark: represents verified, trustworthy data */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-[18px] w-[18px]"
          aria-hidden="true"
        >
          <path
            d="M12 2.5l7 2.5v6c0 5-3 8.5-7 10.5-4-2-7-5.5-7-10.5V5l7-2.5z"
            fill="white"
            fillOpacity="0.15"
            stroke="white"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M8.5 12.2l2.4 2.4 4.6-5"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>
        <span className="block text-base font-semibold leading-tight text-slate-900 group-hover:text-blue-700">
          Data Quality Assistant
        </span>
        <span className="block text-xs leading-tight text-slate-500">
          Find and fix problems in your data — powered by AI
        </span>
      </span>
    </Link>
  );
}
