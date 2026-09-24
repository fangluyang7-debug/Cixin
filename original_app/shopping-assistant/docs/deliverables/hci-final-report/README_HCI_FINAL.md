# SoleAI 智能比价助手 HCI 期末项目运行说明

本说明用于课程提交，配合 `hci_final_report.pdf` 阅读。项目主仓库路径为：

```powershell
D:\shopping-assistant
```

## 1. 环境要求

- Node.js 22 或更高版本
- npm
- Flutter SDK
- Android Studio / Android SDK
- Android Emulator，推荐设备：`emulator-5554`
- 可选：TeX Live 2026，用于重新编译报告 PDF

## 2. 后端 API 启动

```powershell
cd D:\shopping-assistant
npm install
Copy-Item .env.example .env
npm --workspace services/api-server run prisma:generate
npm --workspace services/api-server run db:init
npm run api:dev
```

本地健康检查：

```powershell
curl http://localhost:3000/api/v1/health
```

线上后端基线：

```text
https://apiserver.zeabur.app
```

## 3. 评委入口 Web 页

```powershell
cd D:\shopping-assistant
npm run web:dev
```

本地入口：

```text
http://localhost:5173/
http://localhost:5173/product-pool.html
```

`product-pool.html` 是商品池运维入口，普通用户体验不需要进入。

## 4. Flutter Android 客户端

默认本地 demo 运行：

```powershell
cd D:\shopping-assistant\apps\mobile-flutter
flutter devices
flutter run -d emulator-5554
```

连接线上后端运行：

```powershell
cd D:\shopping-assistant\apps\mobile-flutter
flutter run -d emulator-5554 --dart-define=ENABLE_BACKEND=true --dart-define=API_BASE_URL=https://apiserver.zeabur.app
```

## 5. 云端主链路 smoke 验证

```powershell
cd D:\shopping-assistant
npm run api:smoke:cloud -- `
  -BaseUrl https://apiserver.zeabur.app `
  -ImagePath D:\shopping-assistant\user_image_sample.jpg
```

该脚本会验证：

- `GET /api/v1/health`
- 图片上传
- 创建搜索会话
- 候选商品读取
- 搜索事件回放

## 6. 推荐演示流程

1. 打开 Flutter App 首页。
2. 选择拍照或从相册上传商品图片。
3. 在主体框选页确认商品主体。
4. 等待系统返回候选商品。
5. 查看候选列表中的价格、平台、匹配摘要和购买入口。
6. 输入自然语言要求，例如“500 元以内”“只看有货”“不要某个平台”。
7. 打开商品详情页查看更完整的决策信息。
8. 可选：进入侧栏编辑用户画像，或把候选加入购物车查看推荐扩展。

## 7. 报告重新编译

```powershell
cd D:\shopping-assistant\docs\deliverables\hci-final-report
latexmk -xelatex hci_final_report.tex
```

编译后产物：

```text
hci_final_report.pdf
```

如需渲染检查 PDF 页面：

```powershell
pdftoppm -png hci_final_report.pdf .\rendered\hci_final_report
```

## 8. 提交前待补充

最终提交前请补充：

- 团队成员姓名
- 学号
- 贡献分工
- 若有正式 APK 下载链接，请同步写入评委入口页或本 README
