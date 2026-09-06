export const siteContent = {
  productName: 'Shopping Assistant Runtime Test',
  slogan: 'Just say the word.',
  apiBase:
    import.meta.env.PUBLIC_API_BASE_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    'http://localhost:3000',
  highlights: ['工具注册', '任务图规划', '真实资源匹配', '运行结果验证'],
  steps: ['启动 API', '打开 Android 测试客户端', '提交图片或文字目标', '查看规划和资源状态'],
};
