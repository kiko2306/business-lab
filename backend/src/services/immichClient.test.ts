import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/httpJson', () => ({ requestJson: vi.fn() }));

import { requestJson } from '../utils/httpJson';
import { immichAdminSignUp } from './immichClient';

const mocked = vi.mocked(requestJson);
const reply = (statusCode: number, message: string) =>
  mocked.mockResolvedValue({ statusCode, body: { message }, raw: message } as never);

describe('immichAdminSignUp', () => {
  beforeEach(() => mocked.mockReset());

  it.each(['The server already has an admin', 'Admin setup is not available'])(
    'treats a 400 "%s" as already-exists',
    async (message) => {
      reply(400, message);
      expect(await immichAdminSignUp('http://i', 'a@b.c', 'pw', 'Admin')).toBe('already-exists');
    }
  );

  it('reports created on 2xx and failed on anything else', async () => {
    reply(201, '');
    expect(await immichAdminSignUp('http://i', 'a@b.c', 'pw', 'Admin')).toBe('created');
    reply(500, 'boom');
    expect(await immichAdminSignUp('http://i', 'a@b.c', 'pw', 'Admin')).toBe('failed');
  });
});
