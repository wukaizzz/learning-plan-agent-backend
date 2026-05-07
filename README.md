# React Agent Chat Backend

AI聊天应用后端服务，支持DeepSeek和豆包(Doubao)双模型，具备流式响应和工具调用能力。

## 技术栈

- **运行环境**: Node.js ES Module
- **Web框架**: Express.js
- **HTTP客户端**: Axios
- **跨域处理**: CORS
- **配置管理**: dotenv
- **开发工具**: nodemon

## 项目结构

```
react-project-backend/
├── src/
│   ├── index.js                    # 应用入口，Express服务器配置
│   ├── controllers/                 # 控制器层，处理HTTP请求
│   │   ├── chatController.js       # DeepSeek聊天控制器
│   │   ├── doubaoController.js     # 豆包聊天控制器
│   │   └── toolController.js       # 工具执行控制器
│   ├── routes/                      # 路由层，API端点定义
│   │   ├── chat.js                 # DeepSeek聊天路由
│   │   ├── doubao.js               # 豆包聊天路由
│   │   └── tool.js                 # 工具执行路由
│   └── services/                    # 服务层，业务逻辑实现
│       ├── deepseekService.js      # DeepSeek API服务
│       ├── doubaoService.js        # 豆包API服务
│       └── toolService.js          # 工具执行服务
├── .env                             # 环境配置文件
├── .env.example                     # 环境配置示例
├── package.json                     # 项目依赖配置
└── README.md                        # 项目文档
```

## 核心功能

### 1. 双模型AI聊天

支持DeepSeek和豆包两个AI模型的流式聊天：

- **DeepSeek模型**: 深度求索的通用AI助手
- **豆包模型**: 字节跳动的AI助手
- **流式响应**: 基于Server-Sent Events (SSE)的实时流式输出
- **可配置参数**: 支持自定义系统提示词、温度、最大token数

### 2. 工具调用系统

内置安全可靠的工具执行环境：

- **计算器**: 数学表达式计算
- **天气查询**: 模拟天气数据查询
- **网络搜索**: 模拟搜索功能
- **安全沙箱**: 后端执行确保前端安全

### 3. 健康检查

提供服务状态监控和API密钥配置检查。

## API端点

### POST /api/chat
DeepSeek流式聊天接口

**请求体**:
```json
{
  "messages": [
    { "role": "user", "content": "你好" }
  ],
  "agentConfig": {
    "system_prompt": "你是一个有用的AI助手",
    "temperature": 0.7,
    "max_tokens": 1024
  }
}
```

**响应**: SSE流式数据流
```
data: {"type":"content","content":"你好"}
data: [DONE]
```

### POST /api/doubao
豆包流式聊天接口

**请求体**: 与DeepSeek格式相同

**响应**: SSE流式数据流

### POST /api/tool
工具执行接口

**请求体**:
```json
{
  "toolName": "calculator",
  "params": {
    "expression": "2 + 2"
  }
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "result": 4
  }
}
```

### GET /health
健康检查接口

**响应**:
```json
{
  "status": "ok",
  "timestamp": "2025-04-20T10:30:00.000Z",
  "services": {
    "deepseek": true,
    "doubao": true
  }
}
```

## 环境配置

### 必需配置

```bash
# 服务器端口
PORT=3001

# DeepSeek API密钥
DEEPSEEK_API_KEY=your_deepseek_api_key

# 豆包API密钥
ARK_API_KEY=your_doubao_api_key
```

### 可选配置

```bash
# 豆包API地址（默认：火山引擎北京节点）
ARK_API_URL=https://ark.cn-beijing.volces.com/api/v3/chat/completions

# 豆包模型（默认：doubao-seed-2-0-lite-260215）
ARK_MODEL=doubao-seed-2-0-lite-260215

# CORS跨域配置
CORS_ORIGIN=http://localhost:5173
```

## 开发指南

### 安装依赖

```bash
npm install
# 或
pnpm install
```

### 配置环境

```bash
cp .env.example .env
# 编辑 .env 文件，填入API密钥
```

### 启动服务

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm start
```

### 验证服务

```bash
# 检查服务健康状态
curl http://localhost:3001/health
```

## 架构设计

### 分层架构

1. **路由层**: 定义API端点，处理HTTP路由
2. **控制器层**: 处理请求验证，格式转换，错误处理
3. **服务层**: 实现业务逻辑，与外部API交互

### 数据流

```
前端请求 → Express路由 → 控制器验证 → 服务处理 → 外部API
                    ↓           ↓           ↓
                错误处理    SSE流式响应   结果封装
```

### 安全特性

- API密钥后端管理，前端不可见
- 工具沙箱执行，防止恶意代码
- CORS跨域保护
- 请求参数验证

## 技术特点

1. **模块化设计**: ES6模块化，清晰的目录结构
2. **异步处理**: async/await模式，支持并发请求
3. **流式传输**: SSE实现AI响应的实时传输
4. **错误处理**: 完善的异常捕获和错误响应
5. **配置灵活**: 环境变量控制，支持多模型切换

## 扩展指南

### 添加新的AI模型

1. 在`services/`创建新的服务文件
2. 在`controllers/`创建对应的控制器
3. 在`routes/`添加新的路由
4. 在`index.js`注册路由
5. 更新环境变量配置

### 添加新的工具

在`services/toolService.js`的`tools`对象中添加新工具：

```javascript
const tools = {
  // ... 现有工具
  
  new_tool: {
    execute: async (params) => {
      // 实现工具逻辑
      return { result: '...' };
    }
  }
};
```

## 依赖说明

- **express**: Web框架，处理HTTP请求
- **cors**: 跨域资源共享中间件
- **axios**: HTTP客户端，调用外部API
- **dotenv**: 环境变量管理
- **nodemon**: 开发时自动重启服务

## 注意事项

1. **API密钥安全**: 不要将.env文件提交到版本控制
2. **错误日志**: 生产环境建议添加日志系统
3. **速率限制**: 建议添加请求限流保护
4. **HTTPS**: 生产环境建议使用HTTPS
5. **输入验证**: 加强用户输入的验证和清理

## 故障排查

### 常见问题

1. **API密钥错误**: 检查.env文件中的密钥配置
2. **CORS错误**: 检查前端地址和CORS配置
3. **端口占用**: 修改PORT配置或关闭占用进程
4. **网络超时**: 检查网络连接和API地址配置

### 调试建议

- 使用`/health`端点检查服务状态
- 查看控制台日志了解错误详情
- 使用Postman或curl测试API接口
- 检查网络请求和响应格式

## 许可证

MIT License
