import { execSync } from 'child_process';
import os from 'os';

// 要关闭的端口
const PORT = 5173;

try {
  const isWindows = os.platform() === 'win32';

  if (isWindows) {
    console.log(`正在清理端口 ${PORT}...`);

    // 用 '|| exit 0' 让 findstr 找不到结果时也返回 0，避免 execSync 抛错
    const findCmd = `netstat -ano | findstr :${PORT} || exit 0`;
    const output = execSync(findCmd, { encoding: 'utf8', stdio: 'pipe' }).trim();

    if (output) {
      // 提取 PID（Windows 输出最后一列是 PID）
      const lines = output.split('\n');
      for (const line of lines) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && !isNaN(pid)) {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          console.log(`✅ 已杀死进程 PID: ${pid}`);
        }
      }
    } else {
      console.log(`✅ 端口 ${PORT} 未被占用`);
    }
  }

  console.log(`🎉 端口 ${PORT} 已成功释放！`);

} catch (err) {
  console.error('❌ 清理端口时出错:', err.message);
  // 兜底：直接杀死所有 node 进程
  console.log('⚠️ 兜底清理所有 Node 进程...');
  try {
    execSync('taskkill /f /im node.exe 2>nul', { stdio: 'ignore' });
    console.log('✅ 所有 Node 进程已关闭');
  } catch (e) {
    console.log('⚠️ 没有正在运行的 Node 进程需要清理');
  }
}