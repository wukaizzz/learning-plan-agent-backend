import { config } from '../config.js';
import {
  getLatestPlanBySpace,
  getPlanById,
  savePlanSnapshot,
} from './planPersistenceService.js';

const TASK_PRIORITIES = new Set(['high', 'medium', 'low']);

function mapPriority(priority) {
  if (TASK_PRIORITIES.has(priority)) {
    return priority;
  }
  return Number(priority) >= 7 ? 'high' : Number(priority) >= 5 ? 'medium' : 'low';
}

function mapRuntimePriority(priority) {
  return priority === 'high' ? 8 : priority === 'medium' ? 6 : 3;
}

function formatScheduleGroupLabel(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
}

function withoutTaskPayload(props = {}) {
  const { tasks, scheduleGroups, ...scalarProps } = props;
  return scalarProps;
}

function buildPlanSnapshot(state, uiBlocks) {
  const now = Date.now();
  const planId = state.currentPlan?.planId;
  if (!planId) {
    throw new Error('Cannot persist finalized workflow without currentPlan.planId.');
  }

  const summaryCard = uiBlocks.find(block => block.type === 'summary-card');
  const title = summaryCard?.props?.spaceName || '学习计划';
  const subjectNames = new Map(
    (state.subjects || []).map(subject => [subject.id, subject.name])
  );

  const tasks = (state.tasksSnapshot || []).map((task, order) => ({
    id: task.id,
    planId,
    spaceId: state.studySpaceId,
    subject: subjectNames.get(task.subjectId) || task.subjectName || task.subjectId,
    title: task.title,
    type: task.type,
    priority: mapPriority(task.priority),
    status: task.status || 'pending',
    estimatedMinutes: task.estimatedMinutes,
    scheduledDate: task.scheduledDate,
    groupLabel: task.groupLabel || formatScheduleGroupLabel(task.scheduledDate),
    estimatedTime: task.estimatedTime,
    dependencies: task.dependencies || [],
    order,
    createdAt: now,
    updatedAt: now,
  }));

  const taskIds = tasks.map(task => task.id);
  const blocks = uiBlocks.map((block, order) => ({
    id: block.id,
    planId,
    spaceId: state.studySpaceId,
    type: block.type,
    title: block.title,
    taskIds: block.type === 'daily-task-list' ? taskIds : [],
    props: block.type === 'daily-task-list'
      ? withoutTaskPayload(block.props)
      : block.props,
    order,
    createdAt: now,
    updatedAt: now,
  }));

  return {
    plan: {
      id: planId,
      spaceId: state.studySpaceId,
      title,
      status: 'active',
      version: state.currentPlan.versionNumber || 1,
      createdAt: Date.parse(state.currentPlan.createdAt) || now,
      updatedAt: now,
    },
    tasks,
    blocks,
  };
}

function toDailyTaskItem(task) {
  return {
    id: task.id,
    subject: task.subject,
    task: task.title,
    duration: task.estimatedMinutes,
    priority: task.priority,
    status: task.status,
    estimatedTime: task.estimatedTime || '',
    scheduledDate: task.scheduledDate,
    groupLabel: task.groupLabel,
  };
}

function hydrateTaskBlock(block, tasksById) {
  const tasks = (block.taskIds || [])
    .map(taskId => tasksById.get(taskId))
    .filter(Boolean)
    .sort((left, right) => {
      const dateOrder = left.scheduledDate.localeCompare(right.scheduledDate);
      return dateOrder || left.order - right.order;
    });

  const groups = new Map();
  for (const task of tasks) {
    const group = groups.get(task.scheduledDate) || {
      date: task.scheduledDate,
      label: task.groupLabel || formatScheduleGroupLabel(task.scheduledDate),
      tasks: [],
    };
    group.tasks.push(toDailyTaskItem(task));
    groups.set(task.scheduledDate, group);
  }

  const displayDate = block.props?.date;
  const displayedTasks = displayDate
    ? tasks.filter(task => task.scheduledDate === displayDate)
    : tasks.slice(0, 5);

  return {
    id: block.id,
    type: block.type,
    title: block.title,
    props: {
      ...block.props,
      tasks: displayedTasks.map(toDailyTaskItem),
      scheduleGroups: Array.from(groups.values()),
    },
  };
}

export function hydrateUIBlocksFromPlanSnapshot(snapshot) {
  if (!snapshot) {
    return [];
  }

  const tasksById = new Map(snapshot.tasks.map(task => [task.id, task]));
  return [...snapshot.blocks]
    .sort((left, right) => left.order - right.order)
    .map(block => {
      const hydrated = block.type === 'daily-task-list'
        ? hydrateTaskBlock(block, tasksById)
        : {
            id: block.id,
            type: block.type,
            title: block.title,
            props: { ...block.props },
          };

      return {
        ...hydrated,
        meta: {
          timestamp: snapshot.plan.updatedAt,
          version: String(snapshot.plan.version),
          planId: snapshot.plan.id,
          planVersion: snapshot.plan.version,
          persisted: true,
        },
      };
    });
}

export function mapPersistedTasksToRuntime(snapshot, subjects = []) {
  const subjectIds = new Map(subjects.map(subject => [subject.name, subject.id]));
  return snapshot.tasks.map(task => ({
    id: task.id,
    subjectId: subjectIds.get(task.subject) || task.subject,
    subjectName: task.subject,
    title: task.title,
    type: task.type,
    estimatedMinutes: task.estimatedMinutes,
    scheduledDate: task.scheduledDate,
    priority: mapRuntimePriority(task.priority),
    status: task.status,
    dependencies: task.dependencies || [],
  }));
}

export async function persistFinalizedWorkflowPlan(state, uiBlocks) {
  if (!config.database.enabled) {
    return { persisted: false, currentPlan: state.currentPlan };
  }

  const snapshot = await savePlanSnapshot(
    state.userId,
    buildPlanSnapshot(state, uiBlocks)
  );

  return {
    persisted: true,
    snapshot,
    currentPlan: {
      ...state.currentPlan,
      planId: snapshot.plan.id,
      versionId: snapshot.plan.id,
      versionNumber: snapshot.plan.version,
      status: snapshot.plan.status,
      lastModifiedAt: new Date(snapshot.plan.updatedAt).toISOString(),
    },
  };
}

export function buildFinalizedCheckpointUpdate(state, uiBlocks, persistence) {
  const workflow = {
    ...state.workflow,
    stage: 'finalized',
    currentNode: 'build_ui_blocks',
    history: [{ node: 'build_ui_blocks', timestamp: Date.now(), duration: 200 }],
  };

  if (!persistence.persisted) {
    return {
      uiBlocks,
      workflow,
      metadata: {
        ...state.metadata,
        updatedAt: Date.now(),
        lastActivityAt: Date.now(),
      },
    };
  }

  return {
    currentPlan: persistence.currentPlan,
    tasksSnapshot: [],
    uiBlocks: [],
    progress: {
      completedTasks: state.progress?.completedTasks || 0,
      totalTasks: state.tasksSnapshot?.length || 0,
      overallCompletionRate: state.progress?.overallCompletionRate || 0,
    },
    riskAssessment: {
      level: state.riskAssessment?.level || 'low',
      prediction: state.riskAssessment?.prediction || '',
      suggestedActions: state.riskAssessment?.suggestedActions || [],
    },
    workflow,
    metadata: {
      createdAt: state.metadata?.createdAt,
      updatedAt: Date.now(),
      totalReplans: state.metadata?.totalReplans || 0,
    },
  };
}

export async function loadWorkflowPlan(userId, spaceId, planId) {
  if (!config.database.enabled) {
    return null;
  }

  if (planId) {
    try {
      return await getPlanById(userId, planId);
    } catch (error) {
      if (error.code !== 'PLAN_NOT_FOUND') {
        throw error;
      }
    }
  }

  return getLatestPlanBySpace(userId, spaceId);
}

export async function hydrateFinalizedWorkflowState(state) {
  if (state?.workflow?.stage !== 'finalized') {
    return state;
  }

  const snapshot = await loadWorkflowPlan(
    state.userId,
    state.studySpaceId,
    state.currentPlan?.planId
  );
  if (!snapshot) {
    return state;
  }

  return {
    ...state,
    currentPlan: {
      ...state.currentPlan,
      planId: snapshot.plan.id,
      versionId: snapshot.plan.id,
      versionNumber: snapshot.plan.version,
      status: snapshot.plan.status,
    },
    tasksSnapshot: mapPersistedTasksToRuntime(snapshot, state.subjects),
    uiBlocks: hydrateUIBlocksFromPlanSnapshot(snapshot),
    progress: {
      completedTasks: state.progress?.completedTasks || 0,
      totalTasks: snapshot.tasks.length,
      overallCompletionRate: state.progress?.overallCompletionRate || 0,
      subjectProgress: state.progress?.subjectProgress || {},
      recentWeakPoints: state.progress?.recentWeakPoints || [],
    },
    riskAssessment: {
      level: state.riskAssessment?.level || 'low',
      factors: state.riskAssessment?.factors || [],
      prediction: state.riskAssessment?.prediction || '',
      suggestedActions: state.riskAssessment?.suggestedActions || [],
    },
  };
}

export function buildPlanDataFromPersistence(snapshot, runtimeState, studySpaceContext) {
  if (!snapshot) {
    return null;
  }

  const subjects = runtimeState?.subjects || studySpaceContext?.subjects || [];
  const tasksSnapshot = mapPersistedTasksToRuntime(snapshot, subjects);
  const completedTasks = snapshot.tasks.filter(task => task.status === 'completed').length;

  return {
    goal: runtimeState?.goal || studySpaceContext?.goal || {},
    subjects,
    availability: runtimeState?.availability || studySpaceContext?.availability || {},
    currentPlan: {
      planId: snapshot.plan.id,
      versionId: snapshot.plan.id,
      versionNumber: snapshot.plan.version,
      status: snapshot.plan.status,
      createdAt: new Date(snapshot.plan.createdAt).toISOString(),
      lastModifiedAt: new Date(snapshot.plan.updatedAt).toISOString(),
    },
    tasksSnapshot,
    progress: {
      completedTasks,
      totalTasks: snapshot.tasks.length,
      overallCompletionRate: snapshot.tasks.length
        ? completedTasks / snapshot.tasks.length
        : 0,
    },
    riskAssessment: {
      level: runtimeState?.riskAssessment?.level || 'low',
      factors: runtimeState?.riskAssessment?.factors || [],
      prediction: runtimeState?.riskAssessment?.prediction || '',
      suggestedActions: runtimeState?.riskAssessment?.suggestedActions || [],
    },
  };
}
