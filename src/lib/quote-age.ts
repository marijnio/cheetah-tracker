export interface QuoteAgeInfo {
  label: string; // e.g. "Just now", "25m ago", "3h ago", "1d ago", "3d ago", "No quote"
  shortBadge: string; // e.g. "now", "25m", "3h", "1d", "3d", "None"
  fullDate: string; // e.g. "Nov 3, 2026, 21:32"
  daysOld: number;
  hoursOld: number;
  isStale: boolean; // True if >= 2 days or never fetched
  isDaysOld: boolean; // True if >= 2 days old
  status: "fresh" | "aging" | "stale" | "missing";
  tooltip: string;
}

/**
 * Calculates human-friendly recency metrics and stale warnings for quotes.
 * If a quote is 2 or more days old, isStale / isDaysOld is flagged so traders
 * know immediately that prices need to be refreshed.
 */
export function getQuoteAgeInfo(
  lastQuoteAt?: string | null,
  referenceNowMs?: number
): QuoteAgeInfo {
  if (!lastQuoteAt) {
    return {
      label: "No quote",
      shortBadge: "None",
      fullDate: "Never updated",
      daysOld: 999,
      hoursOld: 9999,
      isStale: true,
      isDaysOld: true,
      status: "missing",
      tooltip: "No live quote has been recorded yet. Refresh or enter manually.",
    };
  }

  const timestamp = new Date(lastQuoteAt).getTime();
  if (isNaN(timestamp)) {
    return {
      label: "Invalid date",
      shortBadge: "—",
      fullDate: "Invalid date",
      daysOld: 999,
      hoursOld: 9999,
      isStale: true,
      isDaysOld: true,
      status: "missing",
      tooltip: "Quote date is invalid.",
    };
  }

  const now = referenceNowMs ?? Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  // Format full date nicely
  const d = new Date(timestamp);
  const fullDate = d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (diffMins < 1) {
    return {
      label: "Just now",
      shortBadge: "now",
      fullDate,
      daysOld: 0,
      hoursOld: 0,
      isStale: false,
      isDaysOld: false,
      status: "fresh",
      tooltip: `Quote updated just now (${fullDate})`,
    };
  }

  if (diffMins < 60) {
    return {
      label: `${diffMins}m ago`,
      shortBadge: `${diffMins}m`,
      fullDate,
      daysOld: 0,
      hoursOld: 0,
      isStale: false,
      isDaysOld: false,
      status: "fresh",
      tooltip: `Quote updated ${diffMins} minutes ago (${fullDate})`,
    };
  }

  if (diffHours < 24) {
    return {
      label: `${diffHours}h ago`,
      shortBadge: `${diffHours}h`,
      fullDate,
      daysOld: 0,
      hoursOld: diffHours,
      isStale: false,
      isDaysOld: false,
      status: "fresh",
      tooltip: `Quote updated ${diffHours} hours ago (${fullDate})`,
    };
  }

  if (diffHours < 48) {
    return {
      label: "1d ago",
      shortBadge: "1d",
      fullDate,
      daysOld: 1,
      hoursOld: diffHours,
      isStale: false,
      isDaysOld: false,
      status: "aging",
      tooltip: `Quote updated yesterday (${fullDate})`,
    };
  }

  // Days old (>= 2 days): Stale warning!
  return {
    label: `${diffDays}d ago`,
    shortBadge: `${diffDays}d`,
    fullDate,
    daysOld: diffDays,
    hoursOld: diffHours,
    isStale: true,
    isDaysOld: true,
    status: "stale",
    tooltip: `Quote is ${diffDays} days old (${fullDate}). Refresh recommended!`,
  };
}

