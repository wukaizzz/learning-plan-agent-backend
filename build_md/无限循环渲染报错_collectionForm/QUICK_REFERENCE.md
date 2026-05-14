# 工作流修复 - 快速参考

## 🚀 快速开始

### 1. 启动后端
```bash
cd react-project-backend
npm run dev
```

### 2. 测试流程
1. 前端输入："帮我生成学习计划"
2. 填写表单并提交
3. 观察后端日志

## 📊 数据流转

### 表单数据格式

**前端发送**（扁平化）：
```json
{
  "goal.examDate": "2024-06-20",
  "goal.targetScore": 85,
  "subjects": ["数学", "英语"],
  "availability.dailyHours": 2
}
```

**后端解析**（嵌套）：
```json
{
  "goal": {
    "examDate": "2024-06-20",
    "targetScore": 85
  },
  "subjects": ["数学", "英语"],
  "availability": {
    "dailyHours": 2
  }
}
```

## 🔧 关键文件

| 文件 | 修改类型 | 关键修改 |
|------|---------|---------|
| `src/utils/formDataParser.js` | ✅ 新建 | 表单数据解析工具 |
| `src/routes/workflowRoutes.js` | ✏️ 修改 | resume 端点使用 parseFormData |
| `src/workflows/initialPlanningWorkflow.js` | ✏️ 修改 | 使用 checkpointer |
| `src/utils/checkpointer.js` | ✏️ 修改 | 改进 getState |

## 🧪 运行测试

```bash
cd react-project-backend
node test-formDataParser.js
```

预期输出：所有测试通过 ✅

## 🎯 修复效果

| 问题 | 修复前 | 修复后 |
|------|-------|-------|
| **数据格式** | `state['goal.examDate']` | `state.goal.examDate` |
| **工作流重置** | 每次从头开始 | 从中断点继续 |
| **AI 访问** | 无法访问 | 正确访问 |

## 📝 检查点

### 后端日志检查点

✅ `✅ 解析后的数据: { goal: { examDate: '...', ... } }`
✅ `📋 获取到之前的状态: { stage: 'collecting', ... }`
✅ `🔄 合并后的状态: { goal: { ... }, subjects: [...] }`
✅ `🟢 工作流继续执行`
✅ `✅ 工作流恢复完成，最终阶段: finalized`

### LangSmith 检查点

✅ Trace 中显示正确的输入数据
✅ AI 提示词包含真实的考试日期和目标分数
✅ 生成的学习计划基于用户输入

## 🔍 故障排查

### 问题：表单提交后工作流仍然中断

**检查**：
1. 后端日志是否显示 "解析后的数据"
2. checkpointer 是否正确获取到之前的状态

**解决方案**：
```javascript
// 检查 checkpointer 是否正确导入
import { checkpointer } from '../utils/checkpointer.js';
```

### 问题：AI 提示词仍然显示 "未设置"

**检查**：
1. `parseFormData` 是否正确转换数据
2. `mergeFormDataToState` 是否正确合并

**解决方案**：
```bash
# 运行测试脚本
node test-formDataParser.js
```

### 问题：LangSmith 中没有数据

**检查**：
1. LangSmith API Key 是否配置
2. `LANGCHAIN_TRACING_V2` 环境变量是否设置

**解决方案**：
```bash
# .env
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your_api_key
```

## 📚 完整文档

详见：`WORKFLOW_FIX_DOCUMENTATION.md`

## ✅ 验证清单

- [ ] 表单数据正确解析为嵌套结构
- [ ] checkpointer 正确获取之前的状态
- [ ] 工作流从中断点继续
- [ ] AI 能够访问到用户输入的数据
- [ ] 后端日志显示正确的数据
- [ ] LangSmith Trace 记录正确数据
- [ ] 生成的学习计划基于真实数据

## 🎉 完成标志

看到以下日志表示修复成功：
```
✅ 工作流恢复完成，最终阶段: finalized
✅ 学习计划生成完成
```
