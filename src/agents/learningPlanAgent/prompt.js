function getTasks(planData = {}) {
  return Array.isArray(planData.tasksSnapshot) ? planData.tasksSnapshot : [];
}

function getTaskDate(task = {}) {
  return task.scheduledDate || task.date || task.startDate || '';
}

function getTaskMinutes(task = {}) {
  return Number(task.estimatedMinutes ?? task.duration ?? 0) || 0;
}

function summarizePlanData(planData = {}) {
  const tasks = getTasks(planData);
  const subjects = Array.isArray(planData.subjects) ? planData.subjects : [];
  const dates = tasks.map(getTaskDate).filter(Boolean).sort();
  const statusCounts = tasks.reduce((acc, task) => {
    const status = task.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const totalMinutes = tasks.reduce((sum, task) => sum + getTaskMinutes(task), 0);
  const sampleTasks = tasks.slice(0, 5).map(task => ({
    id: task.id || task.taskId,
    title: task.title,
    subjectId: task.subjectId,
    date: getTaskDate(task),
    status: task.status || 'unknown',
    estimatedMinutes: getTaskMinutes(task)
  }));

  return {
    goal: planData.goal || null,
    subjectCount: subjects.length,
    subjects: subjects.map(subject => ({
      id: subject.id,
      name: subject.name,
      priority: subject.priority
    })),
    taskCount: tasks.length,
    dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    totalMinutes,
    statusCounts,
    sampleTasks
  };
}

function getLocalDateString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function buildSystemPrompt({ planData, intent, studySpaceId } = {}) {
  const today = getLocalDateString();
  const summary = summarizePlanData(planData);

  return `你是学习计划 ReAct Agent V1，负责基于已有学习计划回答查询、解释、进度建议和 dry-run 调整问题。

当前日期：${today}
学习空间：${studySpaceId || 'unknown'}
用户意图：${intent || 'query_plan'}

计划摘要：
${JSON.stringify(summary, null, 2)}

可用工具：
- search_tasks：按日期、科目、状态查询任务。
- get_schedule_overview：按日期聚合任务数、总分钟数和待完成数。
- get_task_details：按 taskId 查询单个任务详情。
- preview_reschedule_tasks：生成 dry-run 调整预览，不修改真实计划。

规则：
1. 只有需要真实任务列表、日期聚合、任务详情或调整预览时才调用工具。
2. 如果用户信息不足，直接在最终回答中追问，不要调用不存在的工具。
3. 所有调整都只能是预览，不能声称已经修改、保存或写回计划。
4. 不要输出内部 JSON 原文，除非用户明确要求。请用简洁中文总结工具结果。
5. 如果涉及日期，优先使用 YYYY-MM-DD。遇到“今天/明天”时按当前日期推算。
6. 最终回答必须可执行，说明下一步建议和限制。`;
}
