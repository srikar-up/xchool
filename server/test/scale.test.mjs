import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { buildScaleFixture, measureScale } from '../src/scale.js';
import { MAX_DOCUMENT_BYTES } from '../src/layout.js';

const db = buildScaleFixture();
const report = measureScale(db);

describe('1,000 students / 50 teachers scale model', () => {
  test('builds the requested worst-case term', () => {
    assert.equal(report.students, 1000);
    assert.equal(report.staff, 50);
    assert.equal(report.sections, 30);
    assert.ok(report.collections.attendanceSessions.rows > 3000);
    assert.equal(report.collections.testRecords.rows, 4000);
  });

  test('no stored row crosses the safety limit', () => {
    assert.equal(report.overLimit, false);
    for (const [key, entry] of Object.entries(report.collections)) {
      assert.ok(
        entry.documentBytes < MAX_DOCUMENT_BYTES,
        `${key} would write a ${entry.documentBytes} byte document`
      );
      assert.ok(
        entry.documentBytes < 1024 * 1024,
        `${key} would cross the storage safety limit`
      );
    }
  });

  test('one register or mark stays tiny', () => {
    assert.ok(
      report.collections.attendanceSessions.largestRecordBytes < 20 * 1024,
      `attendance register is ${report.collections.attendanceSessions.largestRecordBytes} bytes`
    );
    assert.ok(
      report.collections.testRecords.largestRecordBytes < 2 * 1024,
      `mark record is ${report.collections.testRecords.largestRecordBytes} bytes`
    );
    assert.ok(
      report.collections.students.largestRecordBytes < 5 * 1024,
      `student record is ${report.collections.students.largestRecordBytes} bytes`
    );
  });

  test('every collection is split into per-record rows', () => {
    for (const key of Object.keys(report.collections)) {
      assert.equal(report.collections[key].layout, 'per-record', `${key} should be split`);
    }
  });

  test('a cold start stays inside a realistic daily read budget', () => {
    assert.ok(
      report.coldStartReads < 20_000,
      `cold start would read ${report.coldStartReads} rows`
    );
    assert.ok(report.recordDocuments > 10_000);
  });

  test('a register submission writes a handful of rows', () => {
    assert.equal(report.writesPerAttendanceSubmission, 3);
    assert.ok(report.writesPerMarksSubmission < 50);
  });

  test('the full term fits comfortably in D1 storage', () => {
    assert.ok(report.totalStateBytes < 20 * 1024 * 1024);
  });
});
