// Wait for every worker even when one fails; fallback must never overlap unfinished workers.
export async function collectVectorPartitions(tasks: Promise<Object>[]): Promise<number[][]> {
  const results: Object[] = await Promise.all(tasks.map((task: Promise<Object>) =>
    task.catch((): Object => [] as number[])));
  const partitions: number[][] = results.map((value: Object) => value as number[]);
  if (partitions.some((values: number[]) => values.length === 0 || values.some((value: number) => !Number.isFinite(value)))) {
    throw new Error('TaskPool partition failed.');
  }
  return partitions;
}
