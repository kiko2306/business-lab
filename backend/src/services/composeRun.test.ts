import { describe, expect, it } from 'vitest';
import { composeRunCommand, pipedScript } from './composeRun';

describe('composeRunCommand', () => {
  it('runs a one-off, dependency-free, TTY-less container in the app project', () => {
    const resolved = { projectName: 'kimai', composeArgs: '-f /apps/kimai/docker-compose.yml' };
    expect(composeRunCommand(resolved, '--entrypoint /bin/sh kimai -c "id"')).toBe(
      'docker compose -p kimai -f /apps/kimai/docker-compose.yml run --rm --no-deps -T --entrypoint /bin/sh kimai -c "id"'
    );
  });
});

describe('pipedScript', () => {
  it('carries the script as base64, so nothing in it reaches the host shell', () => {
    const script = `echo "$HOME" \`whoami\` 'quoted' ; rm -rf / && $(id)`;
    const piped = pipedScript(script, 'php');
    const match = /^echo ([A-Za-z0-9+/=]+) \| base64 -d \| php$/.exec(piped);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1], 'base64').toString('utf8')).toBe(script);
  });

  it('keeps multi-byte text intact', () => {
    const piped = pipedScript('ação €', '/bin/sh');
    const b64 = piped.split(' ')[1];
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('ação €');
  });
});
