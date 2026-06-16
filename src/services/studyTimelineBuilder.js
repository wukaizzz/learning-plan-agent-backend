const DAY_MS = 24 * 60 * 60 * 1000;

function parseLocalDateString(value) {
  const match = typeof value === 'string'
    ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    : null;

  if (!match) {
    return null;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(0, 0, 0, 0);

  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return null;
  }

  return date;
}

function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addLocalDays(date, days) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
}

function getSortedTaskDates(tasks, predicate = () => true) {
  return [...new Set((tasks || [])
    .filter(predicate)
    .map(task => parseLocalDateString(task?.scheduledDate))
    .filter(Boolean)
    .map(toLocalDateString))]
    .sort();
}

function getFallbackPhaseDate(start, end, ratio) {
  const totalDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS));
  return toLocalDateString(addLocalDays(start, Math.floor(totalDays * ratio)));
}

function clampDateString(dateString, startDate, endDate) {
  const date = parseLocalDateString(dateString);
  if (!date) {
    return toLocalDateString(startDate);
  }

  if (date.getTime() < startDate.getTime()) {
    return toLocalDateString(startDate);
  }

  if (date.getTime() > endDate.getTime()) {
    return toLocalDateString(endDate);
  }

  return toLocalDateString(date);
}

function dedupeTimelineEvents(events) {
  const seen = new Set();
  return events.filter(event => {
    const key = `${event.date}|${event.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function buildStudyTimeline(tasksSnapshot = [], fallbackStartDate, examDate) {
  const validTaskDates = getSortedTaskDates(tasksSnapshot);
  const fallbackStart = parseLocalDateString(fallbackStartDate) || new Date();
  fallbackStart.setHours(0, 0, 0, 0);

  const startDate = parseLocalDateString(validTaskDates[0]) || fallbackStart;
  const endDate = parseLocalDateString(examDate) || startDate;
  const startDateString = toLocalDateString(startDate);
  const endDateString = toLocalDateString(endDate);

  const practiceDate = getSortedTaskDates(
    tasksSnapshot,
    task => task?.type === 'practice'
  )[0];
  const reviewDate = getSortedTaskDates(
    tasksSnapshot,
    task => task?.type === 'review' || task?.subjectId === 'all'
  )[0];

  const fallbackPracticeDate = getFallbackPhaseDate(startDate, endDate, 1 / 3);
  const fallbackReviewDate = getFallbackPhaseDate(startDate, endDate, 2 / 3);

  const events = dedupeTimelineEvents([
    { date: startDateString, title: '基础巩固阶段', type: 'milestone', importance: 'medium' },
    {
      date: clampDateString(practiceDate || fallbackPracticeDate, startDate, endDate),
      title: '强化训练阶段',
      type: 'milestone',
      importance: 'medium'
    },
    {
      date: clampDateString(reviewDate || fallbackReviewDate, startDate, endDate),
      title: '冲刺复盘阶段',
      type: 'milestone',
      importance: 'high'
    },
    { date: endDateString, title: '考试日', type: 'exam', importance: 'high' }
  ]);

  return {
    startDate: startDateString,
    endDate: endDateString,
    events,
  };
}

export default {
  buildStudyTimeline,
};
