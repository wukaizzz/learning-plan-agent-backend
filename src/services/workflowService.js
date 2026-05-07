/**
 * 工作流事件生成器
 * 用于模拟Agent工作流程中的各种事件
 */

export class WorkflowEventGenerator {
  constructor() {
    this.currentStep = 'empty';
    this.progress = 0;
  }

  /**
   * 生成工作流步骤事件
   */
  generateWorkflowStep(step, message, progress = 0) {
    return {
      type: 'workflow_step',
      step,
      message,
      progress
    };
  }

  /**
   * 生成信息收集事件
   */
  generateInfoNeeded(fieldName, question, fieldType = 'text', options = [], required = true) {
    return {
      type: 'info_needed',
      fieldName,
      question,
      fieldType,
      options,
      required
    };
  }

  /**
   * 生成工具调用事件
   */
  generateToolCall(toolName, parameters, status = 'pending') {
    return {
      type: 'tool_call',
      toolName,
      parameters,
      status
    };
  }

  /**
   * 生成处理进度事件
   */
  generateProcessing(stage, details = '', progress = null) {
    const event = {
      type: 'processing',
      stage,
      details
    };
    if (progress !== null) {
      event.progress = progress;
    }
    return event;
  }

  /**
   * 生成分析结果事件
   */
  generateAnalysisResult(summary, findings = [], recommendations = []) {
    return {
      type: 'analysis_result',
      summary,
      findings,
      recommendations
    };
  }

  /**
   * 模拟完整的学习规划工作流
   * 这个方法展示了如何生成一系列工作流事件
   */
  async *simulateLearningPlanWorkflow(userMessage) {
    // 1. 开始收集阶段
    yield this.generateWorkflowStep('collecting', '🎯 开始分析你的学习需求...', 10);

    // 模拟分析用户消息
    await this.delay(500);

    // 2. 检查是否缺少关键信息
    const hasExamInfo = userMessage.toLowerCase().includes('考试') || userMessage.includes('exam');
    const hasSubjectInfo = userMessage.toLowerCase().includes('数学') || userMessage.toLowerCase().includes('英语');

    if (!hasExamInfo) {
      yield this.generateInfoNeeded(
        'examDate',
        '请问你的考试时间是什么时候？这将帮助我制定更合理的学习计划。',
        'date',
        [],
        true
      );
      yield this.generateProcessing('waiting_for_input', '等待用户提供考试时间...', 20);
    }

    if (!hasSubjectInfo) {
      yield this.generateInfoNeeded(
        'subjects',
        '你需要重点复习哪些科目？',
        'select',
        ['数学', '英语', '物理', '化学', '生物', '其他'],
        true
      );
      yield this.generateProcessing('waiting_for_input', '等待用户提供科目信息...', 30);
    }

    // 3. 分析阶段
    yield this.generateWorkflowStep('analyzing', '🧠 正在分析你的学习数据...', 40);
    await this.delay(800);

    yield this.generateProcessing('analyzing', '正在识别知识薄弱点...', 50);
    await this.delay(600);

    yield this.generateProcessing('analyzing', '正在匹配学习资源...', 60);
    await this.delay(600);

    // 4. 生成分析结果
    yield this.generateAnalysisResult(
      '学习需求分析完成',
      [
        '识别到' + (hasSubjectInfo ? '具体科目' : '通用学习') + '需求',
        '考试时间' + (hasExamInfo ? '已确定' : '待确定'),
        '需要制定个性化学习路径'
      ],
      [
        '建议每天安排2-3小时学习时间',
        '重点突破薄弱知识点',
        '定期进行模拟测试'
      ]
    );

    // 5. 生成计划阶段
    yield this.generateWorkflowStep('generating', '⚡ 正在生成个性化学习计划...', 70);
    await this.delay(1000);

    yield this.generateProcessing('generating', '正在拆分学习目标...', 80);
    await this.delay(500);

    // 6. 工具调用示例
    yield this.generateToolCall('calculator', {
      operation: 'calculate_study_hours',
      examDate: hasExamInfo ? '2024-06-15' : '待定',
      dailyHours: 3
    }, 'executing');

    await this.delay(600);

    yield this.generateToolCall('calculator', {
      operation: 'calculate_study_hours',
      result: '总学习时间: 约180小时'
    }, 'completed');

    // 7. 生成完成
    yield this.generateWorkflowStep('finalized', '✅ 学习计划生成完成！', 100);
  }

  /**
   * 辅助方法：延迟
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 根据用户消息内容智能判断应该生成什么事件
   */
  async *generateEventsFromMessage(userMessage) {
    const lowerMessage = userMessage.toLowerCase();

    // 检测是否是学习规划相关请求
    const isLearningPlanRequest =
      lowerMessage.includes('学习计划') ||
      lowerMessage.includes('study plan') ||
      lowerMessage.includes('制定计划') ||
      lowerMessage.includes('帮我规划');

    if (isLearningPlanRequest) {
      yield* this.simulateLearningPlanWorkflow(userMessage);
    } else {
      // 普通对话，只生成处理事件
      yield this.generateProcessing('thinking', '正在思考...', 50);
      await this.delay(300);
    }
  }
}

// 导出单例
export const workflowEventGenerator = new WorkflowEventGenerator();