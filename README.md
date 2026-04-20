# React Project Backend

Backend server for React Agent Chat application using DeepSeek API.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Configure your DeepSeek API key in `.env`:
```
DEEPSEEK_API_KEY=your_actual_api_key_here
```

4. Start the server:
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

## API Endpoints

- `POST /api/chat` - Stream chat responses
- `POST /api/tool` - Execute tool calls
- `GET /health` - Health check

## Environment Variables

- `PORT` - Server port (default: 3001)
- `DEEPSEEK_API_KEY` - Your DeepSeek API key (required)
- `CORS_ORIGIN` - CORS origin (optional)

## Notes

- The server uses Server-Sent Events (SSE) for streaming responses
- Tools are implemented on the backend for security
- CORS is enabled for development
