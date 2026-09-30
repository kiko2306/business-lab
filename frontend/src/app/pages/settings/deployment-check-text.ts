import { DeploymentCheck } from '../../core/models';

/** `settings.deployment.check.<id>.label` — one static label per check id. */
export function deploymentLabelKey(id: string): string {
  return `settings.deployment.check.${id}.label`;
}

/**
 * The panel subtitle for the deployment checklist. A real singular/plural
 * pair rather than an English "(s)"-style suffix — that read as literal
 * "item(ns)" in Portuguese, not a plural, when found live during an audit
 * (plan.md §789).
 */
export function deploymentSubtitleKey(outstanding: number): string {
  if (outstanding === 0) return 'settings.deployment.subtitleDone';
  return outstanding === 1 ? 'settings.deployment.subtitleOutstandingSingular' : 'settings.deployment.subtitleOutstandingPlural';
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
