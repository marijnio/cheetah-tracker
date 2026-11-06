import React from "react";

export function YahooFinanceIcon({
  className = "w-3.5 h-3.5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Yahoo 'Y' */}
      <path d="M4 5l5.5 7v7" />
      <path d="M15 5l-5.5 7" />
      {/* '!' */}
      <line x1="19" y1="5.5" x2="19" y2="13.5" />
      <circle cx="19" cy="18.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

