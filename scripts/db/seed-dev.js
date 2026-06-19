import { getDatabasePool, closeDatabasePool } from '../../src/db/pool.js';

const now = Date.now();
const userId = 'default-user';
const spaceId = 'space_dev_plan_storage_seed';
const planId = 'plan_space_dev_plan_storage_seed_1';
const taskIds = [
  'task_space_dev_plan_storage_seed_calculus',
  'task_space_dev_plan_storage_seed_linear_algebra',
  'task_space_dev_plan_storage_seed_probability',
];

async function insertSeedData(client) {
  await client.query(`
    INSERT INTO public.users (id, display_name, email, created_at_ms, updated_at_ms)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        email = EXCLUDED.email,
        updated_at_ms = EXCLUDED.updated_at_ms
  `, [userId, 'Default User', 'default-user@example.local', now, now]);

  await client.query(`
    INSERT INTO public.study_spaces (
      user_id, id, name, description, color, goal, subjects, schedule,
      status, current_phase, stats, created_at_ms, updated_at_ms,
      last_active_at_ms, is_placeholder, is_deleted
    )
    VALUES (
      $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb,
      $9, $10, $11::jsonb, $12, $13, $14, false, false
    )
    ON CONFLICT (user_id, id) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        color = EXCLUDED.color,
        goal = EXCLUDED.goal,
        subjects = EXCLUDED.subjects,
        schedule = EXCLUDED.schedule,
        status = EXCLUDED.status,
        current_phase = EXCLUDED.current_phase,
        stats = EXCLUDED.stats,
        updated_at_ms = EXCLUDED.updated_at_ms,
        last_active_at_ms = EXCLUDED.last_active_at_ms,
        is_placeholder = false,
        is_deleted = false
  `, [
    userId,
    spaceId,
    '高等数学期末冲刺',
    '为期末考试做好全面准备，重点复习微积分、线性代数和概率统计。',
    '#3b82f6',
    JSON.stringify({
      primaryGoal: '期末考试获得85分以上，掌握核心概念和解题技巧',
      secondaryGoals: ['完成所有课后习题', '整理错题本'],
      examDate: '2026-07-01T00:00:00.000Z',
      targetScore: 85,
    }),
    JSON.stringify([
      { name: '高等数学' },
      { name: '线性代数' },
      { name: '概率统计' },
    ]),
    JSON.stringify({
      availableHoursPerDay: 3,
      availableDays: ['周一', '周二', '周三', '周四', '周五'],
      preferredTimeSlots: ['晚上'],
      restDays: ['周日'],
      startDate: '2026-06-19T00:00:00.000Z',
    }),
    'active',
    '执行阶段',
    JSON.stringify({
      totalStudyHours: 0,
      consecutiveDays: 0,
      overallProgress: 0,
      tasksCompleted: 0,
      tasksTotal: 3,
    }),
    now,
    now,
    now,
  ]);

  await client.query(`
    INSERT INTO public.plans (
      id, user_id, space_id, title, status, version,
      source_session_id, source_message_id, created_at_ms, updated_at_ms
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (id) DO UPDATE
    SET title = EXCLUDED.title,
        status = EXCLUDED.status,
        version = EXCLUDED.version,
        source_session_id = EXCLUDED.source_session_id,
        source_message_id = EXCLUDED.source_message_id,
        updated_at_ms = EXCLUDED.updated_at_ms
  `, [
    planId,
    userId,
    spaceId,
    '高等数学期末冲刺',
    'active',
    1,
    'session_dev_plan_storage_seed',
    'message_dev_plan_storage_seed',
    now,
    now,
  ]);

  await client.query('DELETE FROM public.tasks WHERE user_id = $1 AND plan_id = $2', [userId, planId]);
  await client.query('DELETE FROM public.plan_blocks WHERE user_id = $1 AND plan_id = $2', [userId, planId]);

  const tasks = [
    {
      id: taskIds[0],
      subject: '高等数学',
      title: '复习极限与连续核心题型',
      type: 'study',
      priority: 'high',
      status: 'pending',
      estimatedMinutes: 90,
      scheduledDate: '2026-07-01',
      groupLabel: 'Day 1',
      estimatedTime: '09:00-10:30',
      dependencies: [],
      order: 0,
    },
    {
      id: taskIds[1],
      subject: '线性代数',
      title: '完成矩阵与特征值专项练习',
      type: 'practice',
      priority: 'medium',
      status: 'pending',
      estimatedMinutes: 60,
      scheduledDate: '2026-07-01',
      groupLabel: 'Day 1',
      estimatedTime: '14:00-15:00',
      dependencies: [taskIds[0]],
      order: 1,
    },
    {
      id: taskIds[2],
      subject: '概率统计',
      title: '整理常见分布公式与错题',
      type: 'review',
      priority: 'medium',
      status: 'pending',
      estimatedMinutes: 45,
      scheduledDate: '2026-07-02',
      groupLabel: 'Day 2',
      estimatedTime: '19:00-19:45',
      dependencies: [],
      order: 0,
    },
  ];

  for (const task of tasks) {
    await client.query(`
      INSERT INTO public.tasks (
        id, user_id, plan_id, space_id, subject, title, type, priority, status,
        estimated_minutes, scheduled_date, group_label, estimated_time,
        dependencies, sort_order, created_at_ms, updated_at_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17)
    `, [
      task.id,
      userId,
      planId,
      spaceId,
      task.subject,
      task.title,
      task.type,
      task.priority,
      task.status,
      task.estimatedMinutes,
      task.scheduledDate,
      task.groupLabel,
      task.estimatedTime,
      JSON.stringify(task.dependencies),
      task.order,
      now,
      now,
    ]);
  }

  const blocks = [
    {
      id: 'block_space_dev_plan_storage_seed_summary',
      type: 'summary-card',
      title: '计划概览',
      taskIds: [],
      props: {
        spaceName: '高等数学期末冲刺',
        primaryGoal: '期末考试获得85分以上，掌握核心概念和解题技巧',
        overallProgress: 0,
      },
      order: 0,
    },
    {
      id: 'block_space_dev_plan_storage_seed_daily_tasks',
      type: 'daily-task-list',
      title: '今日任务',
      taskIds,
      props: {
        date: '2026-07-01',
        totalDuration: 150,
        completionRate: 0,
        totalTaskCount: 3,
        displayedTaskCount: 2,
      },
      order: 1,
    },
  ];

  for (const block of blocks) {
    await client.query(`
      INSERT INTO public.plan_blocks (
        id, user_id, plan_id, space_id, type, title, task_ids, props,
        sort_order, created_at_ms, updated_at_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
    `, [
      block.id,
      userId,
      planId,
      spaceId,
      block.type,
      block.title,
      JSON.stringify(block.taskIds),
      JSON.stringify(block.props),
      block.order,
      now,
      now,
    ]);
  }

  await client.query(`
    INSERT INTO public.agent_executions (
      execution_id, user_id, space_id, session_id, message_id, title, status,
      steps, summary, raw_execution, updated_at_ms
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11)
    ON CONFLICT (execution_id) DO UPDATE
    SET title = EXCLUDED.title,
        status = EXCLUDED.status,
        steps = EXCLUDED.steps,
        summary = EXCLUDED.summary,
        raw_execution = EXCLUDED.raw_execution,
        updated_at_ms = EXCLUDED.updated_at_ms
  `, [
    'execution_space_dev_plan_storage_seed',
    userId,
    spaceId,
    'session_dev_plan_storage_seed',
    'message_dev_plan_storage_seed',
    '开发种子执行记录',
    'completed',
    JSON.stringify([{ stepId: 'seed', title: 'Seed data', status: 'completed' }]),
    'Seed execution completed',
    JSON.stringify({ source: 'seed-dev' }),
    now,
  ]);
}

async function printCounts(client) {
  const tables = [
    'users',
    'study_spaces',
    'plans',
    'tasks',
    'plan_blocks',
    'agent_executions',
  ];
  for (const table of tables) {
    const result = await client.query(`SELECT count(*)::INTEGER AS count FROM public.${table}`);
    console.log(`${table}: ${result.rows[0].count}`);
  }
}

async function main() {
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await insertSeedData(client);
    await client.query('COMMIT');
    console.log('Seed data upserted');
    await printCounts(client);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await closeDatabasePool();
  }
}

main().catch(error => {
  console.error('Seed failed');
  console.error(error.message);
  process.exitCode = 1;
});
