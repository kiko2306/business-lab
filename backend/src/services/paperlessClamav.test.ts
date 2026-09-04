import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import {
  buildPaperlessClamavPlan,
  reconcilePaperlessClamav,
  renderManagedComposeFragment,
  renderPreConsumeScript,
  preConsumeScriptHostPath,
  managedComposeFragmentPath,
  PRE_CONSUME_SCRIPT_CONTAINER_PATH,
} from './paperlessClamav';

vi.mock('../config/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/services')>()),
  resolveComposeFile: vi.fn(),
  getPublishedUpstreamPort: vi.fn(),
}));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedResolve = vi.mocked(resolveComposeFile);
const mockedPort = vi.mocked(getPublishedUpstreamPort);
const mockedGateway = vi.mocked(getHostGatewayIp);

const resolved = (name: string) =>
  ({
    projectName: name,
    appDir: `/apps/${name}`,
    composeFile: `/apps/${name}/docker-compose.yml`,
    composeArgs: `-f /apps/${name}/docker-compose.yml`,
  }) as ReturnType<typeof resolveComposeFile>;

const clamavAbsent = (name: string) =>
  name === 'clamav'
    ? ({ projectName: 'clamav', appDir: '/apps/clamav', composeFile: null, composeArgs: '' } as ReturnType<
        typeof resolveComposeFile
      >)
    : resolved(name);

let appDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperless-clamav-'));
  mockedResolve.mockImplementation((name: string) => resolved(name));
  mockedPort.mockReturnValue(10450);
  mockedGateway.mockResolvedValue('10.201.0.1');
});

afterEach(() => {
  fs.rmSync(appDir, { recursive: true, force: true });
});

describe('renderPreConsumeScript', () => {
  const script = renderPreConsumeScript('10.201.0.1', 10450);

  it('is an executable python script with clamd baked in', () => {
    expect(script.startsWith('#!/usr/bin/env python3')).toBe(true);
    expect(script).toContain('CLAMD_HOST = "10.201.0.1"');
    expect(script).toContain('CLAMD_PORT = 10450');
    expect(script).toContain('b"zINSTREAM\\0"');
  });

  it('rejects a FOUND verdict and fails open otherwise', () => {
    expect(script).toContain('if verdict.endswith("FOUND"):\n    emit(f"REJECTED');
    expect(script).toContain('sys.exit(1)');
    // unreachable clamd -> exit 0
    expect(script).toContain('failing open');
  });

  it('reads the document path from the env Paperless sets, not argv', () => {
    expect(script).toContain('os.environ.get("DOCUMENT_WORKING_PATH")');
    expect(script).toContain('os.environ.get("DOCUMENT_SOURCE_PATH")');
  });
});

describe('renderManagedComposeFragment', () => {
  it('adds only PAPERLESS_PRE_CONSUME_SCRIPT under the paperless-ngx service', () => {
    const fragment = renderManagedComposeFragment();
    expect(fragment).toContain('paperless-ngx:');
    expect(fragment).toContain(`PAPERLESS_PRE_CONSUME_SCRIPT: ${PRE_CONSUME_SCRIPT_CONTAINER_PATH}`);
    expect(fragment).not.toContain('image:');
  });
});

describe('buildPaperlessClamavPlan', () => {
  it('returns the host gateway and clamd published port', async () => {
    expect(await buildPaperlessClamavPlan()).toEqual({ host: '10.201.0.1', port: 10450 });
  });

  it("falls back to clamd's default port when the published port is unknown", async () => {
    mockedPort.mockReturnValue(null);
    expect(await buildPaperlessClamavPlan()).toEqual({ host: '10.201.0.1', port: 3310 });
  });

  it('returns null when ClamAV is not part of the deployment', async () => {
    mockedResolve.mockImplementation(clamavAbsent);
    expect(await buildPaperlessClamavPlan()).toBeNull();
  });
});

describe('reconcilePaperlessClamav', () => {
  it('does nothing for any other service', async () => {
    await reconcilePaperlessClamav('nextcloud', appDir);
    expect(fs.existsSync(managedComposeFragmentPath(appDir))).toBe(false);
  });

  it('writes an executable script and the compose fragment when ClamAV is present', async () => {
    await reconcilePaperlessClamav('paperless', appDir);

    const scriptPath = preConsumeScriptHostPath(appDir);
    expect(fs.existsSync(scriptPath)).toBe(true);
    expect(fs.statSync(scriptPath).mode & 0o111).toBeTruthy(); // executable bits
    expect(fs.readFileSync(scriptPath, 'utf8')).toContain('CLAMD_PORT = 10450');

    const fragment = fs.readFileSync(managedComposeFragmentPath(appDir), 'utf8');
    expect(fragment).toContain('PAPERLESS_PRE_CONSUME_SCRIPT');
  });

  it('removes a previously-written script and fragment when ClamAV leaves the deployment', async () => {
    await reconcilePaperlessClamav('paperless', appDir);
    expect(fs.existsSync(managedComposeFragmentPath(appDir))).toBe(true);

    mockedResolve.mockImplementation(clamavAbsent);
    await reconcilePaperlessClamav('paperless', appDir);

    expect(fs.existsSync(managedComposeFragmentPath(appDir))).toBe(false);
    expect(fs.existsSync(preConsumeScriptHostPath(appDir))).toBe(false);
  });

  it('never throws when the write fails', async () => {
    mockedGateway.mockRejectedValue(new Error('dns down'));
    await expect(reconcilePaperlessClamav('paperless', appDir)).resolves.toBeUndefined();
  });
});
