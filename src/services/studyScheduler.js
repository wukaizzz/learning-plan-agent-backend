import { logger } from '../logger/index.js';

const DEFAULT_DAILY_HOURS = 2;
const DEFAULT_EXAM_DISTANCE = 30;

const SESSION_FOCUS_BY_TYPE = {
  study: ['知识框架', '核心概念', '公式记忆', '回忆检测'],
  practice: ['基础题', '典型题', '错题订正', '限时训练'],
  review: ['错题复盘', '重点回顾', '综合检测', '考前巩固'],
};

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

function normalizeComparableText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTaskTitle(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[，。！？、：；,.;:!?()[\]【】\s_-]/g, '')
    .replace(/题型/g, '题')
    .replace(/练习/g, '训练')
    .replace(/复习回顾/g, '复盘')
    .replace(/知识点/g, '知识');
}

function includesText(source, target) {
  const normalizedSource = normalizeComparableText(source);
  const normalizedTarget = normalizeComparableText(target);
  return !!normalizedSource && !!normalizedTarget && normalizedSource.includes(normalizedTarget);
}

function isComprehensiveReviewTask(task) {
  const text = [
    task.subjectId,
    task.subjectName,
    task.title,
    task.description
  ].map(normalizeComparableText).join(' ');

  return task.type === 'review' && (
    text.includes('综合') ||
    text.includes('全科') ||
    text.includes('全部') ||
    text.includes('所有') ||
    text.includes('all subjects')
  );
}

function resolveTaskSubjectId(task, subjects) {
  const fallbackSubject = subjects[0];
  if (!fallbackSubject) {
    return 'general';
  }

  if (isComprehensiveReviewTask(task)) {
    return 'all';
  }

  const rawSubjectId = normalizeComparableText(task.subjectId);
  const directIdMatch = subjects.find(subject => normalizeComparableText(subject.id) === rawSubjectId);
  if (directIdMatch) {
    return directIdMatch.id;
  }

  const rawSubjectName = normalizeComparableText(task.subjectName);
  const directNameMatch = subjects.find(subject => normalizeComparableText(subject.name) === rawSubjectName);
  if (directNameMatch) {
    return directNameMatch.id;
  }

  const searchableText = [
    task.subjectId,
    task.subjectName,
    task.title,
    task.description
  ].join(' ');

  const containedSubject = subjects.find(subject =>
    includesText(searchableText, subject.id) || includesText(searchableText, subject.name)
  );

  return containedSubject?.id || fallbackSubject.id;
}

function getTaskSubjectName(subjectId, subjects) {
  if (subjectId === 'all') {
    return '综合复习';
  }

  return subjects.find(subject => subject.id === subjectId)?.name || subjects[0]?.name || '未知科目';
}

function buildScheduleConstraints(availability = {}, subjects = []) {
  const dailyHours = Number.isFinite(availability.dailyHours)
    ? availability.dailyHours
    : DEFAULT_DAILY_HOURS;
  const examDistance = Number.isFinite(availability.examDistance)
    ? availability.examDistance
    : DEFAULT_EXAM_DISTANCE;
  const dailyMinutes = Math.max(60, Math.round(dailyHours * 60));

  return {
    totalDays: Math.max(1, Math.round(examDistance)),
    dailyMinutes,
    maxMainTasksPerDay: dailyMinutes <= 120 ? 2 : 3,
    minSessionMinutes: Math.min(60, dailyMinutes),
    maxSessionMinutes: Math.min(120, dailyMinutes),
    subjectCount: Math.max(subjects.length, 1),
    singleSubjectMode: subjects.length <= 1,
    startDate: addLocalDays(new Date(), 0),
  };
}

function normalizeFrameworkTasks(frameworkTasks, subjects) {
  const merged = new Map();

  for (const task of frameworkTasks || []) {
    const subjectId = resolveTaskSubjectId(task, subjects);
    const type = task.type || 'study';
    const title = String(task.title || '学习任务').trim();
    const titleKey = normalizeTaskTitle(title);
    const key = `${subjectId}|${type}|${titleKey}`;
    const estimatedHours = Math.max(0.5, Number(task.estimatedHours) || 1);
    const priority = Math.max(1, Math.min(10, Number(task.priority) || 5));

    const existing = merged.get(key);
    if (existing) {
      existing.estimatedHours += estimatedHours;
      existing.priority = Math.max(existing.priority, priority);
      existing.description = existing.description || task.description;
      continue;
    }

    merged.set(key, {
      ...task,
      taskKey: key,
      subjectId,
      subjectName: getTaskSubjectName(subjectId, subjects),
      title,
      type,
      priority,
      estimatedHours,
      description: task.description || '',
    });
  }

  return [...merged.values()].sort((a, b) => b.priority - a.priority);
}

function getSessionFocus(type, sessionIndex, sessionCount) {
  const focusList = SESSION_FOCUS_BY_TYPE[type] || ['学习推进', '重点巩固', '效果检查'];

  if (sessionIndex === sessionCount) {
    return focusList[Math.min(focusList.length - 1, 2)];
  }

  return focusList[(sessionIndex - 1) % focusList.length];
}

function buildSessionTitle(task, sessionIndex, sessionCount, sessionFocus = getSessionFocus(task.type, sessionIndex, sessionCount), forceSuffix = false) {
  if (sessionCount <= 1 && !forceSuffix) {
    return task.title;
  }

  return `${task.title}（${sessionIndex}/${sessionCount}：${sessionFocus}）`;
}

function expandTaskToSessions(task, constraints) {
  const totalMinutes = Math.max(
    constraints.minSessionMinutes,
    Math.round(task.estimatedHours * 60)
  );
  const sessionCount = Math.max(1, Math.ceil(totalMinutes / constraints.maxSessionMinutes));
  const baseMinutes = Math.floor(totalMinutes / sessionCount);
  const extraMinutes = totalMinutes % sessionCount;

  return Array.from({ length: sessionCount }, (_, index) => {
    const sessionIndex = index + 1;
    const estimatedMinutes = baseMinutes + (index < extraMinutes ? 1 : 0);
    const sessionFocus = getSessionFocus(task.type, sessionIndex, sessionCount);

    return {
      sourceTaskKey: task.taskKey,
      dedupeKey: `${task.taskKey}|${sessionIndex}`,
      baseTitle: task.title,
      originalSessionIndex: sessionIndex,
      originalSessionCount: sessionCount,
      sessionFocus,
      subjectId: task.subjectId,
      title: buildSessionTitle(task, sessionIndex, sessionCount, sessionFocus),
      type: task.type,
      estimatedMinutes,
      priority: task.priority,
      status: 'pending',
    };
  });
}

function expandTasksToSessions(tasks, constraints) {
  return tasks.flatMap(task => expandTaskToSessions(task, constraints));
}

function buildReviewSessions(constraints) {
  if (constraints.totalDays < 7) {
    return [];
  }

  const reviewDays = Math.min(3, Math.max(1, Math.floor(constraints.totalDays * 0.1)));
  return Array.from({ length: reviewDays }, (_, index) => ({
    sourceTaskKey: `review|all|${index + 1}`,
    dedupeKey: `review|all|${index + 1}`,
    subjectId: 'all',
    title: `综合复习 - 第${index + 1}轮`,
    type: 'review',
    estimatedMinutes: Math.min(Math.floor(constraints.dailyMinutes * 0.5), 90),
    priority: 7,
    status: 'pending',
    preferredStartDay: Math.max(0, constraints.totalDays - reviewDays + index),
  }));
}

function createDayBuckets(constraints) {
  return Array.from({ length: constraints.totalDays }, (_, dayIndex) => ({
    date: toLocalDateString(addLocalDays(constraints.startDate, dayIndex)),
    tasks: [],
    minutes: 0,
    keys: new Set(),
    sourceTaskKeys: new Set(),
    subjectIds: new Set(),
  }));
}

function canPlaceTask(bucket, task, constraints) {
  if (bucket.minutes + task.estimatedMinutes > constraints.dailyMinutes) return false;
  if (bucket.tasks.length >= constraints.maxMainTasksPerDay) return false;
  if (bucket.keys.has(task.dedupeKey)) return false;
  if (bucket.sourceTaskKeys.has(task.sourceTaskKey)) return false;
  if (
    !constraints.singleSubjectMode &&
    task.subjectId !== 'all' &&
    bucket.subjectIds.has(task.subjectId)
  ) {
    return false;
  }
  return true;
}

function placeTask(bucket, task) {
  bucket.tasks.push({ ...task, scheduledDate: bucket.date });
  bucket.minutes += task.estimatedMinutes;
  bucket.keys.add(task.dedupeKey);
  bucket.sourceTaskKeys.add(task.sourceTaskKey);
  if (task.subjectId !== 'all') {
    bucket.subjectIds.add(task.subjectId);
  }
}

function orderSessionsByPriorityAndSubject(sessions) {
  const sorted = [...sessions].sort((a, b) => {
    const priorityDiff = b.priority - a.priority;
    if (priorityDiff !== 0) return priorityDiff;
    return a.subjectId.localeCompare(b.subjectId);
  });

  const bySubject = new Map();
  for (const session of sorted) {
    if (!bySubject.has(session.subjectId)) {
      bySubject.set(session.subjectId, []);
    }
    bySubject.get(session.subjectId).push(session);
  }

  const ordered = [];
  while (bySubject.size > 0) {
    for (const [subjectId, subjectSessions] of [...bySubject.entries()]) {
      const next = subjectSessions.shift();
      if (next) {
        ordered.push(next);
      }
      if (subjectSessions.length === 0) {
        bySubject.delete(subjectId);
      }
    }
  }

  return ordered;
}

function findAvailableDay(buckets, task, startDay, constraints) {
  for (let dayIndex = Math.max(0, startDay); dayIndex < buckets.length; dayIndex++) {
    if (canPlaceTask(buckets[dayIndex], task, constraints)) {
      return dayIndex;
    }
  }

  for (let dayIndex = 0; dayIndex < Math.max(0, startDay); dayIndex++) {
    if (canPlaceTask(buckets[dayIndex], task, constraints)) {
      return dayIndex;
    }
  }

  return -1;
}

function findNearestAvailableDayInRange(buckets, task, anchor, constraints, minDay = 0, maxDay = buckets.length - 1) {
  const start = Math.max(0, minDay);
  const end = Math.min(buckets.length - 1, maxDay);
  if (start > end) {
    return -1;
  }

  const clampedAnchor = Math.max(start, Math.min(end, anchor));
  const maxOffset = Math.max(clampedAnchor - start, end - clampedAnchor);

  for (let offset = 0; offset <= maxOffset; offset++) {
    const candidates = offset === 0
      ? [clampedAnchor]
      : [clampedAnchor + offset, clampedAnchor - offset];

    for (const dayIndex of candidates) {
      if (dayIndex < start || dayIndex > end) {
        continue;
      }
      if (canPlaceTask(buckets[dayIndex], task, constraints)) {
        return dayIndex;
      }
    }
  }

  return -1;
}

function getReviewStartDay(reviewSessions, constraints) {
  const preferredStartDays = reviewSessions
    .map(session => session.preferredStartDay)
    .filter(Number.isInteger);

  if (preferredStartDays.length === 0) {
    return constraints.totalDays;
  }

  return Math.max(0, Math.min(...preferredStartDays));
}

function getMaxConsecutiveEmptyDays(buckets) {
  let current = 0;
  let max = 0;

  for (const bucket of buckets) {
    if (bucket.tasks.length === 0) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }

  return max;
}

function isTerminalReviewSession(session) {
  return session.type === 'review' && session.subjectId === 'all';
}

function isSplitTaskSession(task) {
  return !!task.sourceTaskKey &&
    !!task.baseTitle &&
    Number.isInteger(task.originalSessionIndex) &&
    Number.isInteger(task.originalSessionCount) &&
    task.originalSessionCount > 1;
}

function renumberScheduledSessionTitles(tasks) {
  const sessionsBySource = new Map();

  for (const task of tasks) {
    if (!isSplitTaskSession(task)) {
      continue;
    }
    if (!sessionsBySource.has(task.sourceTaskKey)) {
      sessionsBySource.set(task.sourceTaskKey, []);
    }
    sessionsBySource.get(task.sourceTaskKey).push(task);
  }

  for (const sessions of sessionsBySource.values()) {
    const orderedSessions = [...sessions].sort((a, b) => {
      const dateDiff = a.scheduledDate.localeCompare(b.scheduledDate);
      if (dateDiff !== 0) return dateDiff;
      return a.originalSessionIndex - b.originalSessionIndex;
    });
    const scheduledSessionCount = orderedSessions.length;

    orderedSessions.forEach((session, index) => {
      session.title = buildSessionTitle(
        { title: session.baseTitle, type: session.type },
        index + 1,
        scheduledSessionCount,
        session.sessionFocus,
        true
      );
    });
  }
}

function summarizeSessionTruncations(scheduledTasks, unscheduledTasks) {
  const sources = new Map();

  const ensureSource = (task) => {
    if (!isSplitTaskSession(task)) {
      return null;
    }
    if (!sources.has(task.sourceTaskKey)) {
      sources.set(task.sourceTaskKey, {
        sourceTaskKey: task.sourceTaskKey,
        baseTitle: task.baseTitle,
        originalSessionCount: task.originalSessionCount,
        scheduledSessionIndexes: new Set(),
        droppedSessionIndexes: new Set(),
      });
    }
    return sources.get(task.sourceTaskKey);
  };

  for (const task of scheduledTasks) {
    ensureSource(task)?.scheduledSessionIndexes.add(task.originalSessionIndex);
  }

  for (const task of unscheduledTasks) {
    ensureSource(task)?.droppedSessionIndexes.add(task.originalSessionIndex);
  }

  return [...sources.values()]
    .filter(summary => summary.droppedSessionIndexes.size > 0)
    .map(summary => ({
      sourceTaskKey: summary.sourceTaskKey,
      baseTitle: summary.baseTitle,
      originalSessionCount: summary.originalSessionCount,
      scheduledSessionCount: summary.scheduledSessionIndexes.size,
      droppedSessionIndexes: [...summary.droppedSessionIndexes].sort((a, b) => a - b),
    }));
}

function scheduleSessions(sessions, constraints) {
  const buckets = createDayBuckets(constraints);
  const reviewSessions = sessions.filter(isTerminalReviewSession);
  const normalSessions = sessions.filter(session => !isTerminalReviewSession(session));
  const reviewStartDay = getReviewStartDay(reviewSessions, constraints);
  const normalWindowEnd = reviewStartDay > 0
    ? reviewStartDay - 1
    : constraints.totalDays - 1;
  const orderedNormalSessions = orderSessionsByPriorityAndSubject(normalSessions);
  const nextStartBySourceTask = new Map();
  const unscheduled = [];

  for (const session of reviewSessions) {
    const anchor = Number.isInteger(session.preferredStartDay)
      ? session.preferredStartDay
      : reviewStartDay;
    const dayIndex = findNearestAvailableDayInRange(
      buckets,
      session,
      anchor,
      constraints,
      reviewStartDay,
      constraints.totalDays - 1
    );

    if (dayIndex === -1) {
      unscheduled.push(session);
      continue;
    }

    placeTask(buckets[dayIndex], session);
  }

  orderedNormalSessions.forEach((session, index) => {
    const previousSourceDay = nextStartBySourceTask.get(session.sourceTaskKey);
    const minSourceDay = Number.isInteger(previousSourceDay) ? previousSourceDay + 1 : 0;
    const anchor = Math.round(
      (index / Math.max(orderedNormalSessions.length - 1, 1)) * Math.max(normalWindowEnd, 0)
    );
    let dayIndex = findNearestAvailableDayInRange(
      buckets,
      session,
      Math.max(anchor, minSourceDay),
      constraints,
      minSourceDay,
      normalWindowEnd
    );

    if (dayIndex === -1) {
      dayIndex = findNearestAvailableDayInRange(
        buckets,
        session,
        Math.max(anchor, minSourceDay),
        constraints,
        minSourceDay,
        constraints.totalDays - 1
      );
    }

    if (dayIndex === -1) {
      unscheduled.push(session);
      return;
    }

    placeTask(buckets[dayIndex], session);
    nextStartBySourceTask.set(session.sourceTaskKey, dayIndex);
  });

  const scheduledCount = buckets.reduce((total, bucket) => total + bucket.tasks.length, 0);
  logger.debug({
    totalDays: constraints.totalDays,
    normalSessions: normalSessions.length,
    reviewSessions: reviewSessions.length,
    scheduled: scheduledCount,
    unscheduled: unscheduled.length,
    reviewStartDay,
    maxConsecutiveEmptyDays: getMaxConsecutiveEmptyDays(buckets),
  }, 'Study scheduler distribution completed');

  return [
    ...buckets.flatMap(bucket => bucket.tasks),
    ...unscheduled,
  ];
}

function validateAndRepairSchedule(tasks, constraints) {
  const buckets = createDayBuckets(constraints);
  const unscheduled = [];

  for (const task of tasks) {
    const preferredDayIndex = buckets.findIndex(bucket => bucket.date === task.scheduledDate);
    const dayIndex = findAvailableDay(
      buckets,
      task,
      preferredDayIndex >= 0 ? preferredDayIndex : 0,
      constraints
    );

    if (dayIndex === -1) {
      unscheduled.push(task);
      continue;
    }

    placeTask(buckets[dayIndex], task);
  }

  const scheduledTasks = buckets.flatMap(bucket => bucket.tasks);
  const sessionTruncations = summarizeSessionTruncations(scheduledTasks, unscheduled);

  if (unscheduled.length > 0) {
    logger.warn({
      count: unscheduled.length,
      titles: unscheduled.slice(0, 5).map(task => task.title),
      sessionTruncations,
    }, 'Some study tasks could not be scheduled within constraints');
  }

  renumberScheduledSessionTitles(scheduledTasks);

  let id = 1;
  return scheduledTasks.map(task => ({
    id: task.type === 'review' && task.subjectId === 'all'
      ? `review_${id++}`
      : `task_${id++}_${task.subjectId}`,
    subjectId: task.subjectId,
    title: task.title,
    type: task.type,
    estimatedMinutes: task.estimatedMinutes,
    scheduledDate: task.scheduledDate,
    priority: task.priority,
    status: 'pending',
  }));
}

export function deterministicallyScheduleTasks(frameworkTasks, availability, subjects) {
  const constraints = buildScheduleConstraints(availability, subjects);
  const normalized = normalizeFrameworkTasks(frameworkTasks, subjects);
  const sessions = expandTasksToSessions(normalized, constraints);
  const reviews = buildReviewSessions(constraints);
  const scheduled = scheduleSessions([...sessions, ...reviews], constraints);
  return validateAndRepairSchedule(scheduled, constraints);
}

export default {
  deterministicallyScheduleTasks,
};
