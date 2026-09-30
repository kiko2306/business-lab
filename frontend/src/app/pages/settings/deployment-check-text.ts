import { DeploymentCheck } from '../../core/models';

/** `settings.deployment.check.<id>.label` — one static label per check id. */
export function deploymentLabelKey(id: string): string {
  return `settings.deployment.check.${id}.label`;
}

/**
 * `settings.deployment.check.<id>.detail<Done|Todo>[Variant]` — the backend
 * sends only raw values (`DeploymentCheck.params`); this picks which
 * translated sentence to interpolate them into, including the two cases with
 * more than one shape (a backup with or without a server, one user vs many).
 * Keeping the branching here rather than in the template (plan.md §787).
 */
export function deploymentDetailKey(check: DeploymentCheck): string {
  const base = `settings.deployment.check.${check.id}`;
  if (!check.done) {
    return `${base}.detailTodo`;
  }
  if (check.id === 'backup') {
    return `${base}.detailDone${check.params['server'] ? 'WithServer' : ''}`;
  }
  if (check.id === 'admin') {
    return `${base}.detailDone${check.params['userCount'] === 1 ? 'Singular' : 'Plural'}`;
  }
  return `${base}.detailDone`;
}
