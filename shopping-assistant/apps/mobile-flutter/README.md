# Mobile Flutter Test Client

该目录承载 Android Flutter 测试客户端，用于验证购物插件的拍照、检索、筛选和结果展示链路。默认只运行本地界面测试；开启 `ENABLE_BACKEND=true` 后才访问显式配置的后端，不把后端失败伪装成真实结果。

## 当前状态

- 首页：拍照检索、相册选择、自然语言输入和语音入口。
- 拍照后：进入结果页，不在首页下方堆叠结果。
- 图片处理：拍照或相册图片会先压缩为识别用 JPEG。
- 结果页：测试候选池、流式商品卡、多轮条件收敛、建议卡片和商品详情弹层。
- 数据来源：本地界面测试数据或显式配置的后端；两者状态不会混淆。

## 本地运行

```powershell
cd <project>\apps\mobile-flutter
flutter devices
flutter run -d <device>
```

生成并安装 debug APK：

```powershell
flutter build apk --debug
adb install -r build\app\outputs\flutter-apk\app-debug.apk
```

连接后端时：

```powershell
flutter run -d <device> --dart-define=ENABLE_BACKEND=true --dart-define=API_BASE_URL=http://<configured-api-host>:3000
```

设备能力和运行结果以实际探测为准。Runtime 的平台、模型、性能和资源缺口见 `../../docs/runtime-resource-gaps.md`。

## 前端接口

1. 上传图片：`POST /api/v1/assets/images`
2. 创建会话：`POST /api/v1/sessions`
3. 获取候选：`GET /api/v1/sessions/{sessionId}/candidates`
4. 追加要求：`POST /api/v1/sessions/{sessionId}/turns`
5. 商品详情：`GET /api/v1/candidates/{candidateItemId}`
6. 智能建议：`GET /api/v1/sessions/{sessionId}/suggestions`
