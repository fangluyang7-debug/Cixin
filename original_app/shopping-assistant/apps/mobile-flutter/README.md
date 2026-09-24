# Mobile Flutter

该目录承载 Android Flutter 客户端。当前已经完成前端 MVP 首版演示链路，并预留真实后端软连接；默认本地 demo，开启 `ENABLE_BACKEND=true` 后尝试走真实接口，失败自动回退 demo。

## 当前状态

- 首页：白色点阵嵌入黑色背景、黑到紫蓝逐级光晕、大号深色玻璃输入框、拍照检索、相册选择、自然语言输入、语音入口、右下角客服提示气泡。
- 拍照后：进入结果页，不在首页下方堆叠结果。
- 图片处理：拍照或相册图片会先压缩为识别用 JPEG，优先 1280 级别，过大时降到 1120/960，减少上传和识别耗时。
- 结果页：本地 demo 候选池、流式商品卡、多轮条件收敛、建议卡片、商品详情弹层、空结果降级提示。
- 数据来源：默认本地 demo；开启后端后按图片上传、创建会话、候选列表、turn 收敛的顺序对接。

详细进度见：

- `../../docs/13-项目进度跟踪.md`

## 本地运行

```powershell
cd D:\shopping-assistant\apps\mobile-flutter
flutter devices
flutter run -d emulator-5554
```

生成并安装 debug APK：

```powershell
E:\Scoop\apps\flutter\current\bin\flutter.bat build apk --debug
E:\Scoop\apps\android-clt\current\platform-tools\adb.exe install -r build\app\outputs\flutter-apk\app-debug.apk
```

首版页面范围：

- 拍照/上传页
- 会话加载页
- 候选列表页
- 自然语言输入区
- 商品详情页
- 智能建议卡片

## 后端对接提醒

移动端前端开发、预览和截图验证默认使用 Android Emulator，不使用物理真机。默认 AVD 为 `Pixel_API_35`，默认 Flutter device id 为 `emulator-5554`。

启动模拟器：

```powershell
E:\Scoop\apps\android-clt\current\emulator\emulator.exe -avd Pixel_API_35
```

连接已部署后端运行：

```powershell
cd D:\shopping-assistant\apps\mobile-flutter
flutter run -d emulator-5554 --dart-define=ENABLE_BACKEND=true --dart-define=API_BASE_URL=https://apiserver.zeabur.app
```

截图：

```powershell
adb -s emulator-5554 exec-out screencap -p > screenshots/mobile-emulator.png
```

前端接口已按以下顺序预留：

1. 上传图片：`POST /api/v1/assets/images`
2. 创建会话：`POST /api/v1/sessions`
3. 获取候选：`GET /api/v1/sessions/{sessionId}/candidates`
4. 追加要求：`POST /api/v1/sessions/{sessionId}/turns`
5. 商品详情：`GET /api/v1/candidates/{candidateItemId}`
6. 智能建议：`GET /api/v1/sessions/{sessionId}/suggestions`

完整移动端前端开发链路见 `../../docs/23-Mobile前端开发链路.md`。
