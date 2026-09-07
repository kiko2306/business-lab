/**
 * Storage for generated social-media post drafts (plan.md §84.3 / §254 P2).
 *
 * A draft is just a prompt and the text Claude produced from it, kept so the
 * work survives between now and the publish path (P3) / scheduler (P4). No
 * platform targeting, no schedule, no status — those arrive with P3.
 */

import { query } from '../utils/database';

export interface SocialDraft {
  id: number;
  prompt: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: number;
  prompt: string;
  content: string;
  created_at: string;
  updated_at: string;
}

const toDraft = (r: Row): SocialDraft => ({
  id: r.id,
  prompt: r.prompt,
  content: r.content,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function ensureSocialDraftsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS social_drafts (
      id SERIAL PRIMARY KEY,
      prompt TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function listDrafts(): Promise<SocialDraft[]> {
  const result = await query<Row>('SELECT * FROM social_drafts ORDER BY created_at DESC');
  return result.rows.map(toDraft);
}

export async function createDraft(prompt: string, content: string): Promise<SocialDraft> {
  const result = await query<Row>(
    'INSERT INTO social_drafts (prompt, content) VALUES ($1, $2) RETURNING *',
    [prompt, content]
  );
  return toDraft(result.rows[0]);
}

/** Returns the updated draft, or `null` if no row has that id. */
export async function updateDraftContent(id: number, content: string): Promise<SocialDraft | null> {
  const result = await query<Row>(
    'UPDATE social_drafts SET content = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
    [id, content]
  );
  return result.rows[0] ? toDraft(result.rows[0]) : null;
}

/** Returns true if a row was deleted. */
export async function deleteDraft(id: number): Promise<boolean> {
  const result = await query('DELETE FROM social_drafts WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
