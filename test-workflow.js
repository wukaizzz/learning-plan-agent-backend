/**
 * LangGraph 工作流可视化测试脚本
 * 可以直观地看到工作流的执行过程
 */
import { StateGraph, END, Annotation } from '@langchain/langgraph';

import { runInitialPlanning } from './src/workflows/initialPlanningWorkflow.js';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

function log(message, color = 'white') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function printHeader(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60));
}

function printSection(title) {
  console.log('\n' + '─'.repeat(40));
  log(title, 'cyan');
  console.log('─'.repeat(40));
}

function printNodeExecution(nodeName, state) {
  log(`✦ ${nodeName}`, 'yellow');
  console.log(`   状态: ${state.workflow?.stage || 'unknown'}`);
  console.log(`   时间: ${new Date().toLocaleTimeString()}`);
}

function printState(state) {
  printSection('📊 当前状态');

  // 基本信息
  console.log('\n📁 基本信息:');
  console.log(`   学习空间: ${state.studySpaceId}`);
  console.log(`   用户: ${state.userId}`);
  console.log(`   工作流阶段: ${state.workflow?.stage || 'N/A'}`);
  console.log(`   当前节点: ${state.workflow?.currentNode || 'N/A'}`);

  // 目标信息
  if (state.goal) {
    console.log('\n🎯 学习目标:');
    console.log(`   主要目标: ${state.goal.primaryGoal || '未设置'}`);
    console.log(`   考试日期: ${state.goal.examDate || '未设置 ⚠️'}`);
    console.log(`   目标分数: ${state.goal.targetScore || '未设置 ⚠️'}`);
    console.log(`   优先级: ${state.goal.priority || 5}`);
  }

  // 科目信息
  if (state.subjects?.length > 0) {
    console.log('\n📚 科目列表:');
    state.subjects.forEach((subject, i) => {
      console.log(`   ${i + 1}. ${subject.name} (当前${subject.currentLevel} → 目标${subject.targetLevel}, ${subject.priority})`);
    });
  } else {
    console.log('\n📚 科目列表: 无 ⚠️');
  }

  // 时间约束
  if (state.availability) {
    console.log('\n⏰ 时间约束:');
    console.log(`   每日可用: ${state.availability.dailyHours} 小时`);
    console.log(`   距离考试: ${state.availability.examDistance} 天`);
  }

  // 任务快照
  if (state.tasksSnapshot?.length > 0) {
    console.log('\n📋 任务列表 (前5个):');
    state.tasksSnapshot.slice(0, 5).forEach((task, i) => {
      console.log(`   ${i + 1}. ${task.title}`);
      console.log(`      日期: ${task.scheduledDate}, 时长: ${task.estimatedMinutes}分钟, 优先级: ${task.priority}`);
    });
    console.log(`   ... 总计 ${state.tasksSnapshot.length} 个任务`);
  }

  // 风险评估
  if (state.riskAssessment) {
    console.log('\n⚠️  风险评估:');
    const levelColors = { low: 'green', medium: 'yellow', high: 'red', critical: 'red' };
    console.log(`   等级: `, '');
    log(state.riskAssessment.level.toUpperCase(), levelColors[state.riskAssessment.level] || 'white');
    if (state.riskAssessment.factors?.length > 0) {
      console.log('   因素:');
      state.riskAssessment.factors.forEach(factor => {
        console.log(`      - ${factor.description} (严重度: ${factor.severity})`);
      });
    }
  }

  // UI Blocks
  if (state.uiBlocks?.length > 0) {
    console.log('\n🎨 UI Blocks:');
    state.uiBlocks.forEach(block => {
      console.log(`   - ${block.type}: ${block.title || '(无标题)'}`);
    });
  }

  // 中断状态
  if (state.interruption?.isInterrupted) {
    console.log('\n⏸️  工作流中断!');
    console.log(`   原因: ${state.interruption.reason}`);
    console.log(`   等待输入: ${state.interruption.waitingFor?.question}`);
    log('   需要提供信息才能继续', 'yellow');
  }

  // 工作流历史
  if (state.workflow?.history?.length > 0) {
    console.log('\n📜 执行历史:');
    state.workflow.history.forEach((item, i) => {
      console.log(`   ${i + 1}. ${item.node} (${item.duration}ms)`);
    });
  }
}

// ============================================================
// 测试场景
// ============================================================

/**
 * 测试场景1: 信息不完整，触发中断
 */
async function testScenario1_MissingInfo() {
  printHeader('🧪 测试场景1: 信息不完整（应触发中断）');

  const result = await runInitialPlanning(
    'test-space-scenario1',
    'test-user',
    {
      goal: {
        primaryGoal: '准备期末考试'
        // 缺少 examDate, targetScore
      },
      subjects: [] // 空数组，应该触发收集
    }
  );

  printState(result);

  if (result.interruption?.isInterrupted) {
    console.log('\n✅ 测试通过: 工作流正确中断，等待用户输入');
    console.log('\n📝 要继续工作流，请调用 resume API:');
    console.log(`   POST http://localhost:3001/api/workflows/${result.studySpaceId}/resume`);
    console.log('   Body: {');
    console.log('     "goal.examDate": "2025-06-15",');
    console.log('     "goal.targetScore": 85,');
    console.log('     "subjects": [{"id": "math", "name": "高等数学", "currentLevel": 5, "targetLevel": 8, "priority": "high"}]');
    console.log('   }');
  } else {
    console.log('\n❌ 测试失败: 预期应该中断');
  }
}

/**
 * 测试场景2: 信息完整，正常完成
 */
async function testScenario2_CompleteInfo() {
  printHeader('🧪 测试场景2: 信息完整（应生成计划）');

  const result = await runInitialPlanning(
    'test-space-scenario2',
    'test-user',
    {
      goal: {
        primaryGoal: '准备期末考试',
        examDate: '2025-06-15',
        targetScore: 85,
        priority: 8
      },
      subjects: [
        {
          id: 'math',
          name: '高等数学',
          currentLevel: 5,
          targetLevel: 8,
          priority: 'high'
        },
        {
          id: 'english',
          name: '英语',
          currentLevel: 6,
          targetLevel: 7,
          priority: 'medium'
        }
      ],
      availability: {
        dailyHours: 3,
        examDistance: 40
      }
    }
  );

  printState(result);

  if (!result.interruption?.isInterrupted && result.workflow?.stage === 'finalized') {
    console.log('\n✅ 测试通过: 工作流正常完成');
    console.log(`   生成任务数: ${result.tasksSnapshot?.length || 0}`);
    console.log(`   UI Blocks: ${result.uiBlocks?.length || 0}`);
  } else {
    console.log('\n❌ 测试失败: 预期应该完成');
  }
}

/**
 * 测试场景3: 时间紧迫，应触发风险提示
 */
async function testScenario3_TimePressure() {
  printHeader('🧪 测试场景3: 时间紧迫（应生成风险提示）');

  const result = await runInitialPlanning(
    'test-space-scenario3',
    'test-user',
    {
      goal: {
        primaryGoal: '紧急备考',
        examDate: '2025-05-20', // 只有14天
        targetScore: 80,
        priority: 9
      },
      subjects: [
        { id: 'math', name: '高等数学', currentLevel: 3, targetLevel: 8, priority: 'high' },
        { id: 'physics', name: '大学物理', currentLevel: 4, targetLevel: 7, priority: 'high' },
        { id: 'english', name: '英语', currentLevel: 5, targetLevel: 7, priority: 'medium' }
      ],
      availability: {
        dailyHours: 2, // 每天只有2小时
        examDistance: 14 // 只有14天
      }
    }
  );

  printState(result);

  console.log('\n📊 风险评估详情:');
  console.log(`   风险等级: ${result.riskAssessment?.level}`);
  console.log(`   风险预测: ${result.riskAssessment?.prediction || '无'}`);
  console.log(`   建议措施: ${result.riskAssessment?.suggestedActions?.join(', ') || '无'}`);
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log('\n');
  log('🚀 LangGraph 工作流可视化测试', 'bright');
  log('=' .repeat(60), 'white');

  // 显示选项
  console.log('\n请选择测试场景:');
  console.log('  1. 信息不完整（应触发中断）');
  console.log('  2. 信息完整（应生成计划）');
  console.log('  3. 时间紧迫（应生成风险提示）');
  console.log('  4. 运行所有场景');
  console.log('  5. 交互式测试（自定义输入）');

  const args = process.argv.slice(2);
  const choice = args[0] || '4'; // 默认运行所有

  try {
    switch (choice) {
      case '1':
        await testScenario1_MissingInfo();
        break;
      case '2':
        await testScenario2_CompleteInfo();
        break;
      case '3':
        await testScenario3_TimePressure();
        break;
      case '4':
        await testScenario1_MissingInfo();
        await new Promise(resolve => setTimeout(resolve, 2000));
        await testScenario2_CompleteInfo();
        await new Promise(resolve => setTimeout(resolve, 2000));
        await testScenario3_TimePressure();
        break;
      case '5':
        log('\n🔧 交互式测试模式（开发中）', 'yellow');
        break;
      case '6':
        console.log(StateGraph)
        console.log(END)
        console.log(Annotation)
        console.log(Annotation())
        break;
      default:
        log('\n❌ 无效的选择', 'red');
    }
  } catch (error) {
    log('\n❌ 测试失败: ' + error.message, 'red');
    console.error(error);
  }

  console.log('\n' + '='.repeat(60));
  log('测试完成!', 'bright');
  console.log('='.repeat(60) + '\n');
}

// 运行测试
main();
