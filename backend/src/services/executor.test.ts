import { describe, expect, it } from 'vitest';
import { describeUpdate, parseComposeImages } from './executor';

describe('describeUpdate', () => {
  // The message is the only feedback an update gives when nothing goes wrong,
  // so "nothing changed" has to be distinguishable from "it worked".
  it('says so plainly when the pull changed nothing', () => {
    expect(describeUpdate([])).toBe('Already on the latest images.');
  });

  it('names the single image that changed', () => {
    expect(describeUpdate(['mealie/mealie:latest'])).toBe('Updated 1 image: mealie/mealie:latest');
  });

  it('names every image when a multi-container app moves', () => {
    expect(describeUpdate(['immich/server:latest', 'redis:7'])).toBe(
      'Updated 2 images: immich/server:latest, redis:7'
    );
  });

  it('does not claim nothing changed when the image IDs could not be read', () => {
    expect(describeUpdate(null)).toBe('Pulled and recreated. Could not tell which images changed.');
  });
});

describe('parseComposeImages', () => {
  const row = (container: string, id: string, repository = 'x') =>
    ({ ContainerName: container, ID: id, Repository: repository, Tag: 'latest' });

  it('maps each container to its image ID and a readable image name', () => {
    const map = parseComposeImages(
      JSON.stringify([row('immich-server-1', 'sha256:aaa', 'immich/server'), row('immich-redis-1', 'sha256:bbb', 'redis')])
    );
    expect(map?.get('immich-server-1')).toEqual({ id: 'sha256:aaa', name: 'immich/server:latest' });
    expect(map?.get('immich-redis-1')).toEqual({ id: 'sha256:bbb', name: 'redis:latest' });
  });

  it('returns null for output that is not the expected array', () => {
    // Compose printing an error, or a version that does not support
    // --format json, must not read as "no images, so nothing changed".
    expect(parseComposeImages('no such service')).toBeNull();
    expect(parseComposeImages('{}')).toBeNull();
    expect(parseComposeImages('[]')).toBeNull();
  });
});
