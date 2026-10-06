/**
 * The two size styles the header strip borrowed from gethomepage's own
 * widgets (§455): binary GiB with a decimal for memory, decimal GB whole for
 * disk. Anything that shows the same disk or memory next to the strip must
 * use these, or one machine reads as two sets of numbers (plan.md §841).
 */
export function formatGiB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

export function formatGB(bytes: number): string {
  return `${Math.round(bytes / 1000 ** 3)} GB`;
}
