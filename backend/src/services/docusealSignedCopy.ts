/**
 * Keep the shared `signed/` folder (Samba, Nextcloud) in step with DocuSeal's
 * completed documents (§872). DocuSeal has no folder export, so a one-off
 * rails container copies them (`copyDocusealSignedDocuments`). Runs after
 * every DocuSeal start and hourly while it is running; best-effort, never
 * throws. A one-off Rails boot is not free, hence skipping when stopped.
 */

import logger from '../utils/logger';
import { copyDocusealSignedDocuments } from './docusealDb';
import { getServiceStatus } from './status';

const DOCUSEAL_SERVICE = 'docuseal';
const INTERVAL_MS = 60 * 60 * 1000;

export async function syncDocusealSignedCopy(): Promise<void> {
  try {
    const copied = await copyDocusealSignedDocuments();
    if (copied === null) {
      logger.warn('DocuSeal signed-document copy failed');
    } else if (copied > 0) {
      logger.info(`Copied ${copied} signed DocuSeal document(s) to the shared signed/ folder`);
    }
  } catch (error) {
    logger.error('DocuSeal signed-document copy crashed', { error: (error as Error).message });
  }
}

/** Post-`up` hook: same signature as the other executor reconcilers. */
export async function reconcileDocusealSignedCopy(serviceName: string): Promise<void> {
  if (serviceName === DOCUSEAL_SERVICE) {
    await syncDocusealSignedCopy();
  }
}

export function startDocusealSignedCopySweeper(): void {
  setInterval(() => {
    getServiceStatus(DOCUSEAL_SERVICE)
      .then((status) => (status.state === 'running' ? syncDocusealSignedCopy() : undefined))
      .catch((error: Error) => logger.error('DocuSeal signed-copy sweep failed', { error: error.message }));
  }, INTERVAL_MS).unref();
}
