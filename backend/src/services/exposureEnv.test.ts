import { describe, expect, it } from 'vitest';
import { computeExposureEnvOverrides } from './exposureEnv';

const HOST = 'paperless.example.com';

describe('computeExposureEnvOverrides', () => {
  it('sets url keys to the https public URL and host keys to the bare host', () => {
    const out = computeExposureEnvOverrides(
      { url: ['PAPERLESS_URL', 'PAPERLESS_CSRF_TRUSTED_ORIGINS'], host: ['N8N_HOST'] },
      HOST,
      {}
    );
    expect(out.PAPERLESS_URL).toBe('https://paperless.example.com');
    expect(out.PAPERLESS_CSRF_TRUSTED_ORIGINS).toBe('https://paperless.example.com');
    expect(out.N8N_HOST).toBe('paperless.example.com');
  });

  it('appends the host to a comma-separated allow-list, keeping existing entries', () => {
    const out = computeExposureEnvOverrides({ allowedHosts: ['PAPERLESS_ALLOWED_HOSTS'] }, HOST, {
      PAPERLESS_ALLOWED_HOSTS: 'localhost, 127.0.0.1',
    });
    expect(out.PAPERLESS_ALLOWED_HOSTS).toBe('localhost,127.0.0.1,paperless.example.com');
  });

  it('does not duplicate a host already in the list', () => {
    const out = computeExposureEnvOverrides({ allowedHosts: ['H'] }, HOST, { H: `foo,${HOST}` });
    expect(out.H).toBe(`foo,${HOST}`);
  });

  it('strips a scheme and trailing slash from an existing entry, so it can match a Host header', () => {
    const out = computeExposureEnvOverrides({ allowedHosts: ['H'] }, HOST, {
      H: 'https://paperless.example.com/',
    });
    // Not `https://paperless.example.com/,paperless.example.com`: the pasted
    // URL matches no Host header, so keeping it around only hides the mistake.
    expect(out.H).toBe(HOST);
  });

  it('honours a space separator (Nextcloud trusted domains)', () => {
    const out = computeExposureEnvOverrides(
      { allowedHosts: ['NEXTCLOUD_TRUSTED_DOMAINS'], allowedHostsSeparator: ' ' },
      HOST,
      { NEXTCLOUD_TRUSTED_DOMAINS: 'localhost 192.168.1.5' }
    );
    expect(out.NEXTCLOUD_TRUSTED_DOMAINS).toBe(`localhost 192.168.1.5 ${HOST}`);
  });

  it('passes staticOnExposure values through verbatim', () => {
    const out = computeExposureEnvOverrides(
      { staticOnExposure: { N8N_PROTOCOL: 'https', NEXTCLOUD_OVERWRITEPROTOCOL: 'https' } },
      HOST,
      {}
    );
    expect(out).toMatchObject({ N8N_PROTOCOL: 'https', NEXTCLOUD_OVERWRITEPROTOCOL: 'https' });
  });

  it('is empty when nothing is declared', () => {
    expect(computeExposureEnvOverrides({}, HOST, {})).toEqual({});
  });
});
