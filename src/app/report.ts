// «Informar de un error»: the technical details a person copies into an issue. It replaces
// telemetry: nothing is sent; they decide what to paste.

import type { JobView } from '../engine/index.ts';

export const REPO_URL = 'https://github.com/memoriainfinita/compositio';
export const ISSUES_URL = `${REPO_URL}/issues/new`;

export interface ReportContext {
  version: string;
  userAgent: string;
  isolated: boolean;
  multithread: boolean;
  layout: string;
  language: string;
  jobs: readonly JobView[];
}

/** Plain text, one fact per line, then each failed job with the end of its log. */
export function reportText(c: ReportContext): string {
  const failed = c.jobs.filter((j) => j.status === 'failed');
  const lines = [
    `compositio ${c.version}`,
    `browser: ${c.userAgent}`,
    `isolated: ${c.isolated}, multithread: ${c.multithread}`,
    `layout: ${c.layout}, language: ${c.language}`,
    `failed jobs: ${failed.length}`,
    ...failed.flatMap((j) => [`- ${j.label}: ${j.error ?? 'unknown'}`, ...(j.detail ? j.detail.split('\n').map((l) => `    ${l}`) : [])]),
  ];
  return lines.join('\n') + '\n';
}
