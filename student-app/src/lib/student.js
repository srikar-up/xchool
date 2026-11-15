/** Small, student-only presentation helpers. */

export function averagePercentage(results = []) {
  const scored = results.filter((result) => Number.isFinite(result.percentage));
  if (!scored.length) return null;
  return Math.round(
    (scored.reduce((sum, result) => sum + result.percentage, 0) / scored.length) * 10
  ) / 10;
}

export function gradeFor(percentage) {
  if (percentage === null || percentage === undefined) return '—';
  if (percentage >= 90) return 'A+';
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B';
  if (percentage >= 60) return 'C';
  if (percentage >= 50) return 'D';
  if (percentage >= 40) return 'E';
  return 'U';
}

export function gradeTone(percentage) {
  if (percentage === null || percentage === undefined) return 'neutral';
  if (percentage >= 80) return 'success';
  if (percentage >= 60) return 'brand';
  if (percentage >= 40) return 'warning';
  return 'danger';
}

export function progressOf(chapters = []) {
  const total = chapters.length;
  const completed = chapters.filter((chapter) => chapter.status === 'completed').length;
  const inProgress = chapters.filter((chapter) => chapter.status === 'in_progress').length;
  return {
    total,
    completed,
    inProgress,
    percent: total ? Math.round((completed / total) * 100) : 0,
  };
}

export function attendanceRate(entry) {
  return entry?.status === 'present' ? 'Present' : entry?.status || 'Not marked';
}

export function latestRemark(student) {
  const remarks = Object.values(student?.reportRemarks || {}).filter((remark) => remark?.text);
  if (!remarks.length) return null;
  return remarks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
}

export function monthStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(date) {
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export function monthCells(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first grid, matching the rest of the app.
  const leading = (first.getDay() + 6) % 7;
  const cells = [];
  for (let index = 0; index < leading; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ day, iso: value });
  }
  return cells;
}

export function todayPeriods(data, day = new Date().getDay()) {
  return (data?.timetable || [])
    .filter((period) => period.dayOfWeek === day)
    .sort((a, b) => a.periodNumber - b.periodNumber);
}

export function periodState(period, day = new Date().getDay()) {
  if (period.dayOfWeek !== day) return 'future';
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (value) => {
    const [hours, mins] = String(value || '').split(':').map(Number);
    return hours * 60 + (mins || 0);
  };
  if (minutes > toMinutes(period.endTime)) return 'done';
  if (minutes >= toMinutes(period.startTime) && minutes <= toMinutes(period.endTime)) return 'live';
  return 'next';
}
