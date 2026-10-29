// Plan morning-digest § 1. The contract every part of § 2 builds against; the reader lives
// next to it in src/digest/.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, after parsing.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job for the night.
export type DigestRow = {
  job: string;
  owner: string | null; // null stays null here; views render it as `—`
  runs: number; // lines for this job, retries included
  retries: number; // lines with status `retry`
  lastStatus: RunStatus; // status of the job's latest line
  lastError: string | null; // error of the latest line that had one
  firstAt: string; // `at` as written in the log, offset kept
  lastAt: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job; page and JSON use this order as is
  badLines: number; // lines that didn't parse; counted, never thrown
  counts: Record<RunStatus, number>; // good lines per status for the night
};

// Reads runs/<night>.jsonl. Returns null when the night has no file, or when `night` is not
// a YYYY-MM-DD date (so a route param can't reach outside runsDir). An empty file is a Night
// with no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;
