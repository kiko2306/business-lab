/**
 * Stirling-PDF "folder scanning": every subfolder of `/pipeline/watchedFolders`
 * that holds a pipeline JSON is polled (about once a minute), its PDFs run
 * through the pipeline, and the results land in `/pipeline/finishedFolders`.
 * Stirling never invents that JSON, so a plain shared folder does nothing
 * (plan.md §871) — the dashboard writes it, per principle 2 (no console step).
 *
 * Compose mounts the share's `to-stirling-compress/` as the watched `compress`
 * folder and `from-stirling/` as the finished folder (flat names, like
 * `to-paperless`, so the world-writable leaf needs no writable parent). The
 * config lives beside the dropped files and is only written when missing, so
 * a hand edit over SMB survives a restart.
 *
 * ponytail: one pipeline (compress). Another is one more entry in PIPELINES
 * plus its folder in sharedFolders.ts and a mount in the compose file.
 */

import fs from 'fs';
import path from 'path';

const SERVICE = 'stirling-pdf';

const PIPELINES = [{ folder: 'to-stirling-compress', name: 'compress', operation: '/api/v1/misc/compress-pdf', parameters: { optimizeLevel: 5, expectedOutputSize: '' } }];

export function renderCompressPipeline(): string {
  const p = PIPELINES[0];
  return (
    JSON.stringify(
      {
        name: p.name,
        pipeline: [{ operation: p.operation, parameters: p.parameters }],
        // {outputFolder} is the finishedFolders root, i.e. `from-stirling/`.
        outputDir: '{outputFolder}',
        outputFileName: '{filename}-{pipelineName}',
      },
      null,
      2,
    ) + '\n'
  );
}

export function ensureStirlingPipelines(serviceName: string, appDir: string): void {
  if (serviceName !== SERVICE) {
    return;
  }
  for (const p of PIPELINES) {
    const file = path.join(appDir, '..', 'nextcloud', 'data', 'shared', p.folder, `${p.name}.json`);
    if (fs.existsSync(file)) {
      continue;
    }
    // 0644: the Stirling container's uid reads it; it need not write it.
    fs.writeFileSync(file, renderCompressPipeline(), { mode: 0o644 });
  }
}
