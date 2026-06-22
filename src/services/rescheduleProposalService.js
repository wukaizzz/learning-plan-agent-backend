const MOVABLE_STATUSES = new Set(['pending', 'failed']);

function parseDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = parseDate(dateString);
  if (!date) return dateString;
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

function taskDate(task) {
  return task.scheduledDate || task.date || '';
}

function taskId(task) {
  return task.id || task.taskId;
}

function taskMinutes(task) {
  return Math.max(0, Number(task.estimatedMinutes ?? task.duration ?? 0) || 0);
}

function priorityValue(priority) {
  if (typeof priority === 'number') return priority;
  return { high: 8, medium: 6, low: 3 }[priority] || 0;
}

function selectTasks(tasks, request) {
  const requestedIds = request.taskIds?.length ? new Set(request.taskIds) : null;
  return tasks.filter(task => {
    if (!MOVABLE_STATUSES.has(task.status || 'pending')) return false;
    if (requestedIds) return requestedIds.has(taskId(task));
    const date = taskDate(task);
    if (request.dateFrom && date < request.dateFrom) return false;
    if (request.dateTo && date > request.dateTo) return false;
    return true;
  });
}

function orderByDependencies(tasks) {
  const byId = new Map(tasks.map(task => [taskId(task), task]));
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];
  let hasCycle = false;

  function visit(task) {
    const id = taskId(task);
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      hasCycle = true;
      return;
    }
    visiting.add(id);
    for (const dependencyId of task.dependencies || []) {
      const dependency = byId.get(dependencyId);
      if (dependency) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(task);
  }

  [...tasks]
    .sort((a, b) => priorityValue(b.priority) - priorityValue(a.priority))
    .forEach(visit);
  return { ordered, hasCycle };
}

function buildBuckets(tasks, excludedIds, dailyMinutes, maxTasksPerDay) {
  const buckets = new Map();
  for (const task of tasks) {
    if (excludedIds.has(taskId(task))) continue;
    const date = taskDate(task);
    if (!date) continue;
    const bucket = buckets.get(date) || { minutes: 0, tasks: [], subjects: new Set() };
    bucket.minutes += taskMinutes(task);
    bucket.tasks.push(task);
    bucket.subjects.add(task.subjectId || task.subjectName || task.subject);
    buckets.set(date, bucket);
  }
  return { buckets, dailyMinutes, maxTasksPerDay };
}

function dependencyPlacement(task, proposedById, originalById) {
  let minDate = '';
  let minOrder = -1;
  for (const dependencyId of task.dependencies || []) {
    const dependency = proposedById.get(dependencyId) || originalById.get(dependencyId);
    if (!dependency) continue;
    const date = taskDate(dependency);
    const order = Number(dependency.order) || 0;
    if (!minDate || date > minDate || (date === minDate && order > minOrder)) {
      minDate = date;
      minOrder = order;
    }
  }
  return { minDate, minOrder };
}

export function buildRescheduleProposal(planData = {}, request = {}) {
  const tasks = Array.isArray(planData.tasksSnapshot) ? planData.tasksSnapshot : [];
  const selected = selectTasks(tasks, request);
  const selectedIds = new Set(selected.map(taskId));
  const dailyHours = Number(planData.availability?.dailyHours) || 2;
  const dailyMinutes = Math.max(60, Math.round(dailyHours * 60));
  const maxTasksPerDay = dailyMinutes <= 120 ? 2 : 3;
  const unavailable = new Set(planData.availability?.unavailableDates || []);
  const examDate = planData.goal?.examDate || request.dateTo || addDays(localToday(), 30);
  const sourceEnd = request.dateTo || request.dateFrom ||
    selected.map(taskDate).filter(Boolean).sort().at(-1) ||
    localToday();
  const startDate = request.targetDate || addDays(sourceEnd, 1);
  const { ordered, hasCycle } = orderByDependencies(selected);
  const { buckets } = buildBuckets(tasks, selectedIds, dailyMinutes, maxTasksPerDay);
  const originalById = new Map(tasks.map(task => [taskId(task), task]));
  const proposedById = new Map();
  const changes = [];
  const unscheduled = [];

  for (const task of ordered) {
    const dependency = dependencyPlacement(task, proposedById, originalById);
    let candidate = startDate;
    if (dependency.minDate && candidate < dependency.minDate) candidate = dependency.minDate;
    let placed = null;

    while (candidate <= examDate) {
      if (unavailable.has(candidate)) {
        candidate = addDays(candidate, 1);
        continue;
      }
      const bucket = buckets.get(candidate) || { minutes: 0, tasks: [], subjects: new Set() };
      const subject = task.subjectId || task.subjectName || task.subject;
      const sameDayDependencyOrder = candidate === dependency.minDate ? dependency.minOrder : -1;
      const canPlace =
        bucket.minutes + taskMinutes(task) <= dailyMinutes &&
        bucket.tasks.length < maxTasksPerDay &&
        (!subject || !bucket.subjects.has(subject)) &&
        (candidate > dependency.minDate || sameDayDependencyOrder < bucket.tasks.length || !dependency.minDate);

      if (canPlace) {
        const nextTask = {
          ...task,
          status: task.status === 'failed' ? 'pending' : task.status,
          scheduledDate: candidate,
          order: bucket.tasks.length
        };
        bucket.minutes += taskMinutes(task);
        bucket.tasks.push(nextTask);
        if (subject) bucket.subjects.add(subject);
        buckets.set(candidate, bucket);
        proposedById.set(taskId(task), nextTask);
        placed = nextTask;
        changes.push({
          taskId: taskId(task),
          title: task.title,
          fromDate: taskDate(task),
          toDate: candidate,
          estimatedMinutes: taskMinutes(task),
          statusBefore: task.status || 'pending',
          statusAfter: nextTask.status
        });
        break;
      }
      candidate = addDays(candidate, 1);
    }

    if (!placed) {
      unscheduled.push({
        taskId: taskId(task),
        title: task.title,
        reason: `在 ${startDate} 至 ${examDate} 之间没有满足容量、科目和依赖约束的日期`
      });
    }
  }

  const proposedTasks = tasks.map(task => proposedById.get(taskId(task)) || task);
  const affectedDates = [...new Set(changes.flatMap(change => [change.fromDate, change.toDate]))]
    .filter(Boolean)
    .sort();
  const canApply = selected.length > 0 && unscheduled.length === 0 && !hasCycle;

  return {
    canApply,
    proposedTasks,
    changes,
    impact: {
      selectedTaskCount: selected.length,
      movedTaskCount: changes.length,
      affectedDates,
      affectedMinutes: changes.reduce((sum, change) => sum + change.estimatedMinutes, 0)
    },
    validation: {
      valid: canApply,
      dependencyCycle: hasCycle,
      unscheduled,
      constraints: {
        dailyMinutes,
        maxTasksPerDay,
        unavailableDates: [...unavailable],
        examDate
      }
    }
  };
}

export default { buildRescheduleProposal };
