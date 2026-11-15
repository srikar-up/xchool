#!/usr/bin/env node
/**
 * Scale report for 1,000 students / 50 teachers.
 *
 *   node server/scripts/load-test.mjs
 *   node server/scripts/load-test.mjs --students 1500 --days 90
 *
 * The default is a pure model: it builds a realistic term in memory and prints
 * document sizes, cold-start reads and write amplification. It touches no
 * database, so it is safe to run anywhere.
 *
 * `--write --yes` saves the generated fixture as JSON next to the local
 * database (`server/data/loadtest.json`). Point `DATA_DIR` at a directory that
 * contains it as `db.json` to boot the API against the fixture.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScaleFixture, measureScale } from '../src/scale.js';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const options = {
  studentCount: Number(arg('students', '1000')),
  staffCount: Number(arg('staff', '50')),
  sectionCount: Number(arg('sections', '30')),
  schoolDays: Number(arg('days', '60')),
  examCycles: Number(arg('exams', '4')),
};

for (const [key, value] of Object.entries(options)) {
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`--${key} must be a positive number.`);
    process.exit(1);
  }
}

const db = buildScaleFixture(options);
const report = measureScale(db);

console.log('');
console.log(
  `Scale model: ${report.students} students · ${report.staff} staff · ${report.sections} sections`
);
console.log(
  `Rows: ${report.recordDocuments} records + ${report.metaFields} meta fields · cold start reads ${report.coldStartReads}`
);
console.log(
  `Largest row: ${(report.largestDocument / 1024).toFixed(1)} KiB · total state ${(
    report.totalStateBytes / 1024
  ).toFixed(1)} KiB`
);
console.log(
  `Writes per register: ${report.writesPerAttendanceSubmission} · per class marks: ${report.writesPerMarksSubmission}`
);
console.log('');
console.log('Collection'.padEnd(22), 'Rows'.padStart(7), 'Total KiB'.padStart(10), 'Largest KiB'.padStart(12), 'Layout');
for (const [key, entry] of Object.entries(report.collections)
  .sort((a, b) => b[1].largestRecordBytes - a[1].largestRecordBytes)
  .slice(0, 15)) {
  console.log(
    key.padEnd(22),
    String(entry.rows).padStart(7),
    (entry.totalBytes / 1024).toFixed(1).padStart(10),
    (entry.largestRecordBytes / 1024).toFixed(1).padStart(12),
    entry.layout
  );
}
console.log('');
console.log(report.overLimit ? 'FAIL: a row crosses the safety limit.' : 'PASS: every row is under the safety limit.');

if (process.argv.includes('--write')) {
  if (!process.argv.includes('--yes')) {
    console.error('Refusing to write without --yes.');
    process.exit(1);
  }
  const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, 'loadtest.json');
  fs.writeFileSync(target, JSON.stringify(db, null, 2), 'utf8');
  console.log(`Wrote the fixture to ${target}.`);
  console.log('Copy it to db.json in a DATA_DIR of your choice to boot against it.');
}
