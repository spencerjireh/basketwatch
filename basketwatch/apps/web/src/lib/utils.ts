/** Class-name join. Small enough that a dependency would be the wrong trade. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
