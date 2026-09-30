import { deploymentDetailKey, deploymentLabelKey, deploymentSubtitleKey } from './deployment-check-text';
import { DeploymentCheck } from '../../core/models';
import { en } from '../../i18n/en';
import { ptPT } from '../../i18n/pt-pt';

const check = (overrides: Partial<DeploymentCheck>): DeploymentCheck => ({
  id: 'domain',
  done: false,
  fixIn: 'Networking',
  params: {},
  ...overrides,
});

// plan.md §787: label/detail moved out of the backend's English-only strings —
// every check id needs a translated label and detail key in both languages,
// and the two that used to say "run start.sh"/"open /setup" must not any more.
describe('deployment checklist text', () => {
  const ids = ['domain', 'cloudflare-token', 'tunnel', 'npm', 'mail', 'backup', 'admin'];

  it('has a translated label for every check id, in both languages', () => {
    for (const id of ids) {
      const key = deploymentLabelKey(id);
      expect(en[key]).withContext(`en ${key}`).toBeTruthy();
      expect(ptPT[key]).withContext(`pt-PT ${key}`).toBeTruthy();
    }
  });

  it('has a translated detail key for both the done and outstanding state of every check', () => {
    for (const id of ids) {
      for (const done of [true, false]) {
        const key = deploymentDetailKey(check({ id, done, params: done ? { domain: 'x', tunnelIdPrefix: 'x', email: 'x', fromAddress: 'x', smtpHost: 'x', kind: 'x', server: 'x', username: 'x', userCount: 2 } : {} }));
        expect(en[key]).withContext(`en ${key}`).toBeTruthy();
        expect(ptPT[key]).withContext(`pt-PT ${key}`).toBeTruthy();
      }
    }
  });

  it('picks the server-less backup detail when there is no server', () => {
    const key = deploymentDetailKey(check({ id: 'backup', done: true, params: { kind: 'disk' } }));
    expect(key).not.toContain('WithServer');
    expect(en[key]).not.toContain('{{server}}');
  });

  it('picks the with-server backup detail when there is one', () => {
    const key = deploymentDetailKey(check({ id: 'backup', done: true, params: { kind: 'sftp', server: 'nas' } }));
    expect(key).toContain('WithServer');
  });

  it('singularises a one-user admin detail', () => {
    const one = deploymentDetailKey(check({ id: 'admin', done: true, params: { username: 'x', email: 'x', userCount: 1 } }));
    const many = deploymentDetailKey(check({ id: 'admin', done: true, params: { username: 'x', email: 'x', userCount: 2 } }));
    expect(one).not.toBe(many);
  });

  it('never tells the operator to run start.sh or open /setup', () => {
    for (const id of ids) {
      const key = deploymentDetailKey(check({ id, done: false, params: {} }));
      expect(en[key]).withContext(`en ${key}`).not.toMatch(/start\.sh|\/setup/i);
      expect(ptPT[key]).withContext(`pt-PT ${key}`).not.toMatch(/start\.sh|\/setup/i);
    }
  });
});

// plan.md §789: found live during an audit — pt-PT's outstanding-count subtitle
// read literally "item(ns)", mirroring English's "(s)" trick, which isn't valid
// Portuguese. Split into real singular/plural keys instead.
describe('deploymentSubtitleKey', () => {
  it('has a translated key for done, one outstanding, and many outstanding, in both languages', () => {
    for (const key of [deploymentSubtitleKey(0), deploymentSubtitleKey(1), deploymentSubtitleKey(3)]) {
      expect(en[key]).withContext(`en ${key}`).toBeTruthy();
      expect(ptPT[key]).withContext(`pt-PT ${key}`).toBeTruthy();
    }
  });

  it('picks a different key for one outstanding than for many', () => {
    expect(deploymentSubtitleKey(1)).not.toBe(deploymentSubtitleKey(3));
  });

  it('never leaves a literal "(s)"-style suffix in either language', () => {
    for (const count of [0, 1, 3]) {
      const key = deploymentSubtitleKey(count);
      expect(en[key]).withContext(`en ${key}`).not.toMatch(/\(s\)|\(ns\)/i);
      expect(ptPT[key]).withContext(`pt-PT ${key}`).not.toMatch(/\(s\)|\(ns\)/i);
    }
  });
});
