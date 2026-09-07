export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "@mika_reyes" -> "MR", "@kxnn02" -> "KX" — first letter of each
 * underscore-separated segment (up to two), or the first two characters of
 * the whole username when there's no underscore. Matches the design's
 * avatar initials. */
export function initialsFor(username: string): string {
  const parts = username.split("_").filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return username.slice(0, 2).toUpperCase();
}

