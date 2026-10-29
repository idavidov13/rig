import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// Plan morning-digest § 2d. Fixtures live in a temp runs dir; `runs/` is read-only.

type Entry = { at: string; job: string; status: 'ok' | 'retry' | 'fail'; owner: string | null; error?: string };
type JsonNight = { night: string; rows: { job: string; owner: string | null }[]; badLines: number };

const entry = (e: Entry) => JSON.stringify(e);

const NORMAL = '2026-10-20';
const EMPTY = '2026-10-21';
const BAD = '2026-10-22';
const MISSING = '2026-01-01';

const normalLines = [
  entry({ at: '2026-10-20T02:00:00+01:00', job: 'gamma/fail', status: 'fail', owner: 'ivan', error: 'boom' }),
  entry({ at: '2026-10-20T02:01:00+01:00', job: 'alpha/ok', status: 'ok', owner: 'ivan' }),
  entry({ at: '2026-10-20T02:02:00+01:00', job: 'delta/noowner', status: 'ok', owner: null }),
  entry({ at: '2026-10-20T02:03:00+01:00', job: 'beta/retry3', status: 'retry', owner: 'sam' }),
  entry({ at: '2026-10-20T02:04:00+01:00', job: 'beta/retry3', status: 'retry', owner: 'sam' }),
  entry({ at: '2026-10-20T02:05:00+01:00', job: 'beta/retry3', status: 'retry', owner: 'sam' }),
  entry({ at: '2026-10-20T02:06:00+01:00', job: 'beta/retry3', status: 'ok', owner: 'sam' }),
];

const badNightLines = [
  entry({ at: '2026-10-22T02:00:00+01:00', job: 'one/ok', status: 'ok', owner: 'ivan' }),
  '{"at":"2026-10-22T02:01:00+01:00","job":"trunc',
  entry({ at: '2026-10-22T02:02:00+01:00', job: 'two/ok', status: 'ok', owner: null }),
];

let dir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  writeFileSync(join(dir, `${NORMAL}.jsonl`), `${normalLines.join('\n')}\n`);
  writeFileSync(join(dir, `${EMPTY}.jsonl`), '');
  writeFileSync(join(dir, `${BAD}.jsonl`), `${badNightLines.join('\n')}\n`);
  app = createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: dir,
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// The table row (`<tr ...>...</tr>`) that contains the job name.
function rowHtml(html: string, job: string): string {
  const chunk = html.split('<tr').find((c) => c.includes(job));
  if (chunk === undefined) throw new Error(`no row for ${job}`);
  return chunk;
}

describe('GET /digest/:night', () => {
  it('renders the normal night', async () => {
    const res = await app.request(`/digest/${NORMAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('html');
    for (const job of ['alpha/ok', 'beta/retry3', 'delta/noowner', 'gamma/fail']) {
      expect(html).toContain(job);
    }
    expect(rowHtml(html, 'delta/noowner')).toContain('—');
    expect(rowHtml(html, 'beta/retry3')).toContain('class="warn"');
    expect(rowHtml(html, 'gamma/fail')).toContain('class="warn"');
    expect(rowHtml(html, 'alpha/ok')).not.toContain('class="warn"');
  });

  it('404 for a night with no file', async () => {
    expect((await app.request(`/digest/${MISSING}`)).status).toBe(404);
  });

  it('404 for a param that is not YYYY-MM-DD', async () => {
    expect((await app.request('/digest/latest')).status).toBe(404);
    expect((await app.request('/digest/..%2Fpackage')).status).toBe(404);
  });

  it('says "nothing ran" for the empty night', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('still renders a night with a bad line', async () => {
    const res = await app.request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('one/ok');
    expect(html).toContain('two/ok');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns { night, rows, badLines } sorted by job', async () => {
    const res = await app.request(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('json');
    const body = (await res.json()) as JsonNight;
    expect(body.night).toBe(NORMAL);
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual(['alpha/ok', 'beta/retry3', 'delta/noowner', 'gamma/fail']);
    expect(body.rows.find((r) => r.job === 'delta/noowner')?.owner).toBeNull();
  });

  it('lists jobs in the same order as the page', async () => {
    const html = await (await app.request(`/digest/${NORMAL}`)).text();
    const body = (await (await app.request(`/api/digest/${NORMAL}`)).json()) as JsonNight;
    const jobs = body.rows.map((r) => r.job);
    const inPageOrder = jobs
      .map((job) => ({ job, at: html.indexOf(job) }))
      .filter((p) => p.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((p) => p.job);
    expect(inPageOrder).toEqual(jobs);
  });

  it('404 for a night with no file', async () => {
    expect((await app.request(`/api/digest/${MISSING}`)).status).toBe(404);
  });

  it('404 for a param that is not YYYY-MM-DD', async () => {
    expect((await app.request('/api/digest/latest')).status).toBe(404);
    expect((await app.request('/api/digest/..%2Fpackage')).status).toBe(404);
  });

  it('empty night: no rows, no bad lines', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as JsonNight;
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('bad-line night: counts the bad line, keeps the good rows', async () => {
    const res = await app.request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as JsonNight;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['one/ok', 'two/ok']);
  });
});
