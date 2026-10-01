const contactDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
});

const contactTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatContactTimestamp(
  value: string | null | undefined,
  unavailable = "Not available",
): string {
  if (!value) return unavailable;

  const trimmed = value.trim();
  const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(trimmed);

  if (Number.isNaN(date.getTime())) return value;
  return `${contactDateFormatter.format(date)} ${contactTimeFormatter.format(date)}`;
}
