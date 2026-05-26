// pi-detect smoke tests — exercise the discovery order without requiring
// Pi to be installed in the CI environment. We point $CTRL_PI_BIN at a
// known-bad path and confirm the error envelope still carries the search
// trail (the kernel uses that trail to render the install hint).

import { describe, expect, it } from 'vitest';
import { detectPi, PiNotFoundError } from '../pi-detect.ts';

const ENV_KEY = 'CTRL_PI_BIN';

describe('pi-detect', () => {
  it('throws PiNotFoundError when no candidate resolves', () => {
    const prior = process.env[ENV_KEY];
    process.env[ENV_KEY] = '/tmp/definitely-not-a-real-pi-binary-9f3a7c';

    // Hide PATH so the second strategy fails as well — the test environment
    // may have npx/pi visible otherwise.
    const priorPath = process.env.PATH;
    process.env.PATH = '/var/empty';

    try {
      expect(() => detectPi()).toThrow(PiNotFoundError);
    } finally {
      if (prior === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prior;
      if (priorPath === undefined) delete process.env.PATH;
      else process.env.PATH = priorPath;
    }
  });

  it('PiNotFoundError records the searched paths', () => {
    const prior = process.env[ENV_KEY];
    process.env[ENV_KEY] = '/tmp/also-not-pi-9f3a7c';
    const priorPath = process.env.PATH;
    process.env.PATH = '/var/empty';

    try {
      detectPi();
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PiNotFoundError);
      const err = e as PiNotFoundError;
      expect(err.searched.length).toBeGreaterThan(0);
      expect(err.message).toContain('npm i -g @earendil-works/pi-coding-agent');
    } finally {
      if (prior === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prior;
      if (priorPath === undefined) delete process.env.PATH;
      else process.env.PATH = priorPath;
    }
  });
});
