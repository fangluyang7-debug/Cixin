export const siteContent = {
  productName: 'SoleAI 智能比价助手',
  slogan: 'Just say the word.',
  apiBase:
    import.meta.env.PUBLIC_API_BASE_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    'https://apiserver.zeabur.app',
  apkUrl: import.meta.env.PUBLIC_APK_DOWNLOAD_URL || '#',
  highlights: ['真实结果返回快', '自然语言无固定语法', '严格同款优先', '前端交互惊艳'],
  steps: ['下载 APK', '允许安装未知来源应用', '打开应用并上传鞋图', '用自然语言继续收敛结果'],
};
