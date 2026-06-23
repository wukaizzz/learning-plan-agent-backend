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
- get_schedule_overview：按日期返回日程统计和具体任务明细。
- get_task_details：按 taskId 查询单个任务详情。
- get_progress_summary：从当前任务快照重新计算完成情况、逾期任务、今日任务和下一批任务。
- propose_reschedule_tasks：确定性生成并保存待确认的计划调整提案，不直接应用。
- preview_reschedule_tasks：生成 dry-run 调整预览，不修改真实计划。

只读意图的工具策略：
1. query_plan
   - 查询任务列表时使用 search_tasks。
   - 查询某日或时间范围的日程时使用 get_schedule_overview；该工具已经返回具体任务，不要再调用 search_tasks。
   - 只有用户同时要求按科目或状态筛选时，才额外使用 search_tasks。
2. progress_next_step
   - 必须先调用 get_progress_summary。
   - 用户指定日期时，可以继续调用 search_tasks 或 get_schedule_overview 补充该日期的事实。
3. explain_plan
   - 解释单个任务时使用 get_task_details。
   - 解释整体安排时使用 get_schedule_overview，必要时使用 search_tasks 补充任务事实。
   - 只能依据目标、科目优先级、风险评估、任务日期和任务优先级作结构性推断。
   - 当前系统没有存储原始排课理由，不得声称读取到了未存储的安排原因；应明确说明解释属于基于现有数据的结构性推断。
4. adjust_plan
   - 可先使用 search_tasks 确认用户要移动的任务范围。
   - 必须使用 propose_reschedule_tasks 生成待确认提案。
   - 不得调用 preview_reschedule_tasks，也不得声称提案已经应用。
5. replan
   - 继续使用 preview_reschedule_tasks，仅返回 dry-run，不创建可确认提案。

通用规则：
1. 信息不足时直接追问，不要调用不存在的工具。
2. 所有调整都只能是预览，不得声称已经修改、保存或写回计划。
3. 不要输出内部 JSON 原文，除非用户明确要求。
4. 涉及日期时优先使用 YYYY-MM-DD；“今天/明天”按当前日期推算。
5. 所有只读回答都要区分事实结果与下一步建议，并说明能力限制。
6. 最终回答使用简洁中文，不得虚构任务、进度、排课理由或工具结果。`;
}
