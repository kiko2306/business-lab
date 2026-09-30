import { ServiceStatus } from './models';

/**
 * The stopped `dependsOn` apps `target` needs, dependencies first, target
 * excluded (plan.md §769). `requires` is deliberately ignored: it never blocks a
 * start, so "start with what it needs" must not start it either. The visited
 * set makes a dependency cycle harmless rather than an infinite loop.
 */
export function startChain(target: string, services: ServiceStatus[]): string[] {
  const byName = new Map(services.map((s) => [s.name, s]));
  const seen = new Set<string>([target]);
  const order: string[] = [];
  const visit = (name: string): void => {
    for (const dep of byName.get(name)?.dependsOn ?? []) {
      const svc = byName.get(dep);
      if (!svc || seen.has(dep)) {
        continue;
      }
      seen.add(dep);
      visit(dep);
      if (svc.state !== 'running') {
        order.push(dep);
      }
    }
  };
  visit(target);
  return order;
}
