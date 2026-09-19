/**
 * The contract's line is a whole number N, and OVER needs strictly more than N. Showing it as N.5
 * says exactly the same thing with nothing left to argue about: at 9.5, 9 is UNDER and 10 is OVER.
 */
export function lineText(threshold: number): string {
  return `${Math.floor(threshold)}.5`
}
