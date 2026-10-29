import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');
  const row = (job: string) => night?.rows.find((r) => r.job === job);

  it('has 5 jobs, sorted, and 1 bad line', () => {
    expect(night?.badLines).toBe(1);
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('counts retries and keeps times as written', () => {
    expect(row('fixtures/refresh')).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps the last failure and its error', () => {
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded', owner: 'lane-07' });
  });

  it('keeps a row whose owner is null', () => {
    expect(row('digest/render')).toMatchObject({ owner: null, runs: 1, lastError: null });
  });
});

describe('readNight edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));

  it('reads an empty file as a night with no rows', () => {
    writeFileSync(join(dir, '2026-01-01.jsonl'), '');
    expect(readNight(dir, '2026-01-01')).toEqual({ night: '2026-01-01', rows: [], badLines: 0 });
  });

  it('returns null for a night with no file', () => {
    expect(readNight(dir, '2026-01-02')).toBeNull();
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    expect(readNight(dir, '../2026-01-01')).toBeNull();
    expect(readNight(dir, 'latest')).toBeNull();
  });

  it('ignores blank lines and counts lines with the wrong shape', () => {
    const lines = [
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":"x"}',
      '',
      '{"at":"2026-01-03T02:00:00+01:00","job":"a","status":"done","owner":"x"}',
      '{"job":"a","status":"ok","owner":"x"}',
      '{"at":"2026-01-03T03:00:00+01:00","job":"a","status":"ok","owner":7}',
      '[1,2]',
    ];
    writeFileSync(join(dir, '2026-01-03.jsonl'), lines.join('\n') + '\n');
    const night = readNight(dir, '2026-01-03');
    expect(night?.badLines).toBe(4);
    expect(night?.rows).toHaveLength(1);
  });
});
