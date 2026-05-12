export function formatPersonName(name: string | null | undefined): string {
  const trimmed = name?.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const [last, ...rest] = trimmed.split(",");
  if (rest.length === 0) return trimmed;
  const first = rest.join(",").trim().replace(/\s+/g, " ");
  return first ? `${first} ${last.trim()}` : trimmed;
}

export function firstNameOnly(name: string | null | undefined, fallback = "there"): string {
  return formatPersonName(name).split(/\s+/)[0] || fallback;
}
