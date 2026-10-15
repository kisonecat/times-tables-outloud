export const MAX_FACTOR = 12;
export const ALL_TABLES: readonly number[] = Array.from({ length: MAX_FACTOR }, (_, i) => i + 1);

/** Unordered key for a fact, smaller factor first: factKey(8, 7) === '7x8'. */
export function factKey(a: number, b: number): string {
  return a <= b ? `${a}x${b}` : `${b}x${a}`;
}

export function parseFactKey(fact: string): [number, number] {
  const [a, b] = fact.split('x').map(Number);
  if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) {
    throw new Error(`Bad fact key: ${fact}`);
  }
  return [a, b];
}

/** Every unordered fact that involves at least one of the given tables, sorted. */
export function factsForTables(tables: readonly number[]): string[] {
  const keys = new Set<string>();
  for (const t of tables) {
    for (let n = 1; n <= MAX_FACTOR; n++) keys.add(factKey(t, n));
  }
  return [...keys].sort((x, y) => {
    const [xa, xb] = parseFactKey(x);
    const [ya, yb] = parseFactKey(y);
    return xa - ya || xb - yb;
  });
}
