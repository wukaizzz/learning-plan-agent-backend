# 聊天界面工作流测试说明

## 测试流程

### 1. 启动服务

**后端：**
```bash
cd react-project-backend
npm start
```

**前端：**
```bash
cd react-project
npm run dev
```

### 2. 进入聊天界面

1. 打开浏览器访问前端地址
2. 进入聊天/对话界面

### 3. 测试场景

#### 场景 A：触发工作流（信息不完整）

输入以下任一消息：
- "帮我生成一个学习计划"
- "帮我制定计划"
- "创建学习计划"

**预期结果：**
1. 后端检测到意图，调用 LangGraph 工作流
2. 工作流检测到信息不完整（缺少考试日期、目标分数等）
3. 前端显示：
   - WorkflowSection 区域出现（在聊天顶部）
   - 显示 collection-form UI Block（信息收集表单）
   - AI 回复需要补充信息

#### 场景 B：完整信息触发

如果想测试完整流程，需要先提供完整信息。可以在后续对话中补充：
- "考试日期是6月15日"
- "目标分数是85分"

**预期结果：**
- 前端显示 summary-card（学习概况）
- 前端显示 daily-task-list（每日任务）
- 前端显示 study-timeline（学习时间线）
- 前端显示 action-bar（操作按钮）

## 代码流程

### 后端流程
```
用户消息 → chatController.js
  ↓
detectPlanGenerationIntent() 检测意图
  ↓
发送 workflow_step 事件 (collecting)
  ↓
runInitialPlanning() 调用 LangGraph 工作流
  ↓
工作流执行 → collectMissingInfo → buildUIBlocks
  ↓
发送 ui_block_update 事件 (每个 block)
  ↓
发送 content 事件 (总结文本)
  ↓
发送 [DONE]
```

### 前端流程
```
handleSendMessage()
  ↓
streamResponse() → useStream.ts
  ↓
接收 workflow_step → transitionToState() → workspaceState = 'collecting'
  ↓
接收 ui_block_update → addUIBlock() → uiBlocks 更新
  ↓
接收 content → addAssistantMessage()
  ↓
WorkflowSection 检测到 isWorkflowActive = true
  ↓
renderBlocks(uiBlocks) → 渲染各个 UI Block 组件
```

## 调试方法

### 查看后端日志
后端会输出详细的日志：
```
🎯 检测到学习计划生成意图，启动 LangGraph 工作流
📂 [loadSpaceContext] 加载学习空间 [spaceId: ...]
🔍 [collectMissingInfo] 检查缺失信息
⏸️ [collectMissingInfo] 发现 X 个缺失字段，触发中断
...
```

### 查看前端日志
浏览器控制台会显示：
```
🔄 Workflow state transition: collecting
🎨 UI Block update: { action: 'add', block: {...} }
```

### 检查 UI Blocks 渲染
打开浏览器开发者工具，检查 DOM 中是否有对应的 UI Block 组件渲染。

## 已实现的 UI Block 组件

- ✅ summary-card - 学习概况卡片
- ✅ daily-task-list - 每日任务列表
- ✅ study-timeline - 学习时间线
- ✅ risk-alert - 风险警告
- ✅ action-bar - 操作按钮
- ✅ collection-form - 信息收集表单
- ✅ generating-skeleton - 生成中骨架屏
- ✅ workflow-indicator - 工作流指示器
- ✅ progress-bar - 进度条
- ✅ tool-call-status - 工具调用状态
