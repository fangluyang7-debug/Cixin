import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:camera/camera.dart' as camera;
import 'package:image_picker/image_picker.dart';

import 'core/api/api_client.dart';
import 'core/images/recognition_image_compressor.dart';
import 'core/local/local_json_store.dart';
import 'core/services/latest_screenshot_service.dart';
import 'core/widgets/product_app_jump_button.dart';
import 'features/capture/latest_screenshot_detector.dart';

const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000',
);
const backendEnabled = bool.fromEnvironment('ENABLE_BACKEND');

const voiceChannel = MethodChannel('shopping_assistant/voice');
const locationChannel = MethodChannel('shopping_assistant/location');

final requirementSubmitter = RequirementSubmitter(
  apiBaseUrl: apiBaseUrl,
  backendEnabled: backendEnabled,
);
final sessionShoppingCartStore = SessionShoppingCartStore();

const _minSubjectSelectionSize = 0.16;
const _defaultFigmaSubjectSelection = RecognitionImageSelection(
  left: 0.25,
  top: 0.25,
  width: 0.50,
  height: 0.50,
);

Future<RecognitionImageSelection> _defaultSubjectSelectionForImage(
  File imageFile,
) async {
  try {
    final bytes = await imageFile.readAsBytes();
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    final image = frame.image;
    final rect = _defaultSubjectRectForImageSize(
      Size(image.width.toDouble(), image.height.toDouble()),
    );
    image.dispose();
    codec.dispose();
    return _recognitionSelectionFromRect(rect);
  } catch (_) {
    return _defaultFigmaSubjectSelection;
  }
}

Rect _defaultSubjectRectForImageSize(Size imageSize) {
  if (imageSize.height >= imageSize.width) {
    return const Rect.fromLTWH(0.18, 0.10, 0.64, 0.78);
  }
  return const Rect.fromLTWH(0.14, 0.16, 0.72, 0.68);
}

Rect _rectFromRecognitionSelection(RecognitionImageSelection selection) {
  return _clampSubjectRect(
    Rect.fromLTWH(
      selection.left,
      selection.top,
      selection.width,
      selection.height,
    ),
  );
}

RecognitionImageSelection _recognitionSelectionFromRect(Rect rect) {
  final clamped = _clampSubjectRect(rect);
  return RecognitionImageSelection(
    left: clamped.left,
    top: clamped.top,
    width: clamped.width,
    height: clamped.height,
  );
}

Rect _clampSubjectRect(Rect rect) {
  final width = rect.width.clamp(_minSubjectSelectionSize, 1.0).toDouble();
  final height = rect.height.clamp(_minSubjectSelectionSize, 1.0).toDouble();
  final left = rect.left.clamp(0.0, 1.0 - width).toDouble();
  final top = rect.top.clamp(0.0, 1.0 - height).toDouble();
  return Rect.fromLTWH(left, top, width, height);
}

Future<CaptureImageResult?> openSoleLensCapturePage(
  BuildContext context, {
  Duration transitionDuration = const Duration(milliseconds: 260),
}) {
  return Navigator.of(context).push<CaptureImageResult>(
    PageRouteBuilder<CaptureImageResult>(
      transitionDuration: transitionDuration,
      reverseTransitionDuration: const Duration(milliseconds: 200),
      pageBuilder: (_, animation, __) => FadeTransition(
        opacity: animation,
        child: const SoleLensCapturePage(),
      ),
    ),
  );
}

class CaptureImageResult {
  const CaptureImageResult({
    required this.file,
    required this.source,
  });

  final File file;
  final ImageSource source;
}

class SoleLensCapturePage extends StatefulWidget {
  const SoleLensCapturePage({super.key});

  @override
  State<SoleLensCapturePage> createState() => _SoleLensCapturePageState();
}

class _SoleLensCapturePageState extends State<SoleLensCapturePage>
    with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  final _galleryPicker = ImagePicker();
  late final AnimationController _frameAnimation;
  camera.CameraController? _cameraController;
  List<camera.CameraDescription> _cameras = const [];
  int _cameraIndex = 0;
  int _cameraInitToken = 0;
  bool _isInitializingCamera = true;
  bool _isTakingPhoto = false;
  bool _isPickingGallery = false;
  String? _cameraMessage;

  bool get _isBusy => _isTakingPhoto || _isPickingGallery;

  @override
  void initState() {
    super.initState();
    _frameAnimation = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    )..repeat();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_initializeCamera());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _frameAnimation.dispose();
    _cameraController?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final controller = _cameraController;
    if (controller == null || !controller.value.isInitialized) return;
    if (state == AppLifecycleState.inactive) {
      unawaited(controller.dispose());
      _cameraController = null;
    } else if (state == AppLifecycleState.resumed) {
      unawaited(_initializeCamera());
    }
  }

  Future<void> _initializeCamera({int? preferredIndex}) async {
    final token = ++_cameraInitToken;
    setState(() {
      _isInitializingCamera = true;
      _cameraMessage = null;
    });
    try {
      final cameras = await camera.availableCameras();
      if (!mounted || token != _cameraInitToken) return;
      if (cameras.isEmpty) {
        setState(() {
          _cameras = const [];
          _isInitializingCamera = false;
          _cameraMessage = '未检测到可用相机';
        });
        return;
      }

      final selectedIndex = preferredIndex == null
          ? _defaultCameraIndex(cameras)
          : preferredIndex.clamp(0, cameras.length - 1).toInt();
      final nextController = camera.CameraController(
        cameras[selectedIndex],
        camera.ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: camera.ImageFormatGroup.jpeg,
      );
      await nextController.initialize();
      if (!mounted || token != _cameraInitToken) {
        await nextController.dispose();
        return;
      }

      final previousController = _cameraController;
      _cameraController = nextController;
      await previousController?.dispose();
      if (!mounted) return;
      setState(() {
        _cameras = cameras;
        _cameraIndex = selectedIndex;
        _isInitializingCamera = false;
        _cameraMessage = null;
      });
    } on camera.CameraException catch (error) {
      if (!mounted || token != _cameraInitToken) return;
      setState(() {
        _isInitializingCamera = false;
        _cameraMessage = _cameraErrorText(error);
      });
    } catch (error) {
      if (!mounted || token != _cameraInitToken) return;
      setState(() {
        _isInitializingCamera = false;
        _cameraMessage = '相机启动失败';
      });
    }
  }

  int _defaultCameraIndex(List<camera.CameraDescription> cameras) {
    final backIndex = cameras.indexWhere(
      (item) => item.lensDirection == camera.CameraLensDirection.back,
    );
    return backIndex == -1 ? 0 : backIndex;
  }

  String _cameraErrorText(camera.CameraException error) {
    if (error.code == 'CameraAccessDenied' ||
        error.code == 'CameraAccessDeniedWithoutPrompt' ||
        error.code == 'CameraAccessRestricted') {
      return '需要相机权限才能拍照';
    }
    return '相机启动失败';
  }

  Future<void> _switchCamera() async {
    if (_isBusy || _isInitializingCamera || _cameras.length < 2) return;
    final nextIndex = (_cameraIndex + 1) % _cameras.length;
    await _initializeCamera(preferredIndex: nextIndex);
  }

  Future<void> _takePhoto() async {
    if (_isBusy) return;
    final controller = _cameraController;
    if (controller == null || !controller.value.isInitialized) {
      _showMessage(_cameraMessage ?? '相机正在启动');
      return;
    }
    if (controller.value.isTakingPicture) return;
    setState(() => _isTakingPhoto = true);
    try {
      final captured = await controller.takePicture();
      if (!mounted) return;
      Navigator.of(context).pop(
        CaptureImageResult(
          file: File(captured.path),
          source: ImageSource.camera,
        ),
      );
    } on camera.CameraException catch (error) {
      if (mounted) _showMessage(_cameraErrorText(error));
    } catch (_) {
      if (mounted) _showMessage('拍照失败，请重试');
    } finally {
      if (mounted) setState(() => _isTakingPhoto = false);
    }
  }

  Future<void> _pickGalleryImage() async {
    if (_isBusy) return;
    setState(() => _isPickingGallery = true);
    try {
      final picked = await _galleryPicker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1024,
        imageQuality: 70,
      );
      if (!mounted || picked == null) return;
      Navigator.of(context).pop(
        CaptureImageResult(
          file: File(picked.path),
          source: ImageSource.gallery,
        ),
      );
    } finally {
      if (mounted) setState(() => _isPickingGallery = false);
    }
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 2),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final bottomPadding = media.padding.bottom;
    final screenSize = media.size;
    final sheetPeek = max(154.0, screenSize.height * 0.18);
    final controlBottom = sheetPeek + bottomPadding + 14;
    final frameTop = max(media.padding.top + 128, screenSize.height * 0.20);
    final frameHeight = min(screenSize.width * 0.96, screenSize.height * 0.46);
    final frameRect = Rect.fromLTWH(
      28,
      frameTop,
      max(0.0, screenSize.width - 56),
      frameHeight,
    );
    final frameActive = _cameraMessage == null && !_isInitializingCamera;

    return Scaffold(
      backgroundColor: const Color(0xFF050608),
      body: Stack(
        children: [
          Positioned.fill(child: _buildCameraPreview()),
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withValues(alpha: 0.42),
                    Colors.black.withValues(alpha: 0.05),
                    Colors.black.withValues(alpha: 0.08),
                    Colors.black.withValues(alpha: 0.58),
                  ],
                  stops: const [0, 0.22, 0.64, 1],
                ),
              ),
            ),
          ),
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: _frameAnimation,
                builder: (context, child) {
                  return CustomPaint(
                    painter: SoleLensFramePainter(
                      active: frameActive,
                      frameRect: frameRect,
                      progress: _frameAnimation.value,
                    ),
                  );
                },
              ),
            ),
          ),
          SafeArea(
            bottom: false,
            child: Stack(
              children: [
                const Positioned(
                  top: 18,
                  left: 0,
                  right: 0,
                  child: Center(child: SoleLensTitlePill()),
                ),
                Positioned(
                  left: 18,
                  top: 12,
                  child: IconButton(
                    tooltip: '关闭',
                    onPressed: () => Navigator.of(context).maybePop(),
                    icon: const Icon(Icons.close_rounded),
                    color: Colors.white,
                    iconSize: 34,
                  ),
                ),
                if (_cameras.length > 1)
                  Positioned(
                    right: 20,
                    top: 18,
                    child: SoleLensIconButton(
                      icon: Icons.cameraswitch_rounded,
                      tooltip: '切换摄像头',
                      onTap: _switchCamera,
                    ),
                  ),
              ],
            ),
          ),
          if (_cameraMessage != null || _isInitializingCamera)
            Positioned(
              left: 42,
              right: 42,
              top: max(media.padding.top + 214, screenSize.height * 0.34),
              child: Center(
                child: SoleLensStatusPill(
                  isLoading: _isInitializingCamera,
                  text: _cameraMessage ?? '正在启动相机',
                ),
              ),
            ),
          Positioned(
            left: 0,
            right: 0,
            bottom: controlBottom,
            child: SoleLensCaptureControls(
              isTakingPhoto: _isTakingPhoto,
              onCapture: _takePhoto,
            ),
          ),
          SoleLensGallerySheet(
            isPicking: _isPickingGallery,
            onPickGallery: _pickGalleryImage,
          ),
        ],
      ),
    );
  }

  Widget _buildCameraPreview() {
    final controller = _cameraController;
    if (controller == null || !controller.value.isInitialized) {
      return const SoleLensFallbackPreview();
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final aspectRatio = controller.value.aspectRatio;
        return ClipRect(
          child: OverflowBox(
            alignment: Alignment.center,
            child: FittedBox(
              fit: BoxFit.cover,
              child: SizedBox(
                width: constraints.maxWidth,
                height: constraints.maxWidth * aspectRatio,
                child: camera.CameraPreview(controller),
              ),
            ),
          ),
        );
      },
    );
  }
}

class SoleLensFallbackPreview extends StatelessWidget {
  const SoleLensFallbackPreview({super.key});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: SoleLensFallbackPainter(),
      child: const SizedBox.expand(),
    );
  }
}

class SoleLensFallbackPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final backgroundPaint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          Color(0xFF222629),
          Color(0xFF686D65),
          Color(0xFFB9B79F),
          Color(0xFF4E544F),
        ],
      ).createShader(rect);
    canvas.drawRect(rect, backgroundPaint);

    final shadowPaint = Paint()
      ..color = Colors.black.withValues(alpha: 0.30)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 22);
    canvas.drawRect(
      Rect.fromLTWH(0, size.height * 0.16, size.width, size.height * 0.13),
      shadowPaint,
    );

    final grainPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.06)
      ..strokeWidth = 1;
    for (var i = 0; i < 44; i += 1) {
      final y = size.height * (0.42 + i * 0.011);
      canvas.drawLine(
        Offset(size.width * 0.18, y),
        Offset(size.width * 0.92, y + size.width * 0.18),
        grainPaint,
      );
    }

    final vignette = Paint()
      ..shader = RadialGradient(
        colors: [
          Colors.transparent,
          Colors.black.withValues(alpha: 0.48),
        ],
      ).createShader(rect);
    canvas.drawRect(rect, vignette);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class SoleLensTitlePill extends StatelessWidget {
  const SoleLensTitlePill({super.key});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 14, sigmaY: 14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            color: const Color(0xFF111827).withValues(alpha: 0.48),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.auto_awesome_rounded,
                size: 17,
                color: Color(0xFFFFD37B),
              ),
              SizedBox(width: 7),
              Text(
                'SoleAI Lens',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  height: 18 / 15,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SoleLensIconButton extends StatelessWidget {
  const SoleLensIconButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: ClipOval(
        child: BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: 14, sigmaY: 14),
          child: Material(
            color: const Color(0xFF111827).withValues(alpha: 0.48),
            child: InkWell(
              onTap: onTap,
              child: SizedBox(
                width: 48,
                height: 48,
                child: Icon(icon, color: Colors.white, size: 24),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class SoleLensFramePainter extends CustomPainter {
  const SoleLensFramePainter({
    required this.active,
    required this.frameRect,
    required this.progress,
  });

  final bool active;
  final Rect frameRect;
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final screenRect = Offset.zero & size;
    final targetRect = frameRect.intersect(screenRect).deflate(2);
    if (targetRect.isEmpty) return;

    final targetRRect = RRect.fromRectAndRadius(
      targetRect,
      const Radius.circular(18),
    );

    final outsidePath = Path()
      ..fillType = PathFillType.evenOdd
      ..addRect(screenRect)
      ..addRRect(targetRRect);
    canvas.drawPath(
      outsidePath,
      Paint()..color = Colors.black.withValues(alpha: active ? 0.34 : 0.46),
    );

    final highlightPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          Colors.white.withValues(alpha: active ? 0.16 : 0.08),
          Colors.white.withValues(alpha: active ? 0.06 : 0.03),
          const Color(0xFFFF8A1F).withValues(alpha: active ? 0.035 : 0.0),
        ],
        stops: const [0, 0.64, 1],
      ).createShader(targetRect);
    canvas.drawRRect(targetRRect, highlightPaint);

    final innerStrokePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..color = Colors.white.withValues(alpha: active ? 0.16 : 0.08);
    canvas.drawRRect(targetRRect, innerStrokePaint);

    _paintScanDots(canvas, targetRect);
    _paintCorners(canvas, targetRect);
  }

  void _paintCorners(Canvas canvas, Rect rect) {
    final pulse = active ? 0.84 + sin(progress * pi * 2) * 0.08 : 0.58;
    final cornerPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5.2
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = Colors.white.withValues(alpha: pulse);
    final glowPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 10
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8)
      ..color = Colors.white.withValues(alpha: active ? 0.12 : 0.04);

    const inset = 8.0;
    final left = rect.left + inset;
    final top = rect.top + inset;
    final right = rect.right - inset;
    final bottom = rect.bottom - inset;
    final corner = min(rect.width, rect.height) * 0.16;

    void drawCorner(Path path) {
      canvas.drawPath(path, glowPaint);
      canvas.drawPath(path, cornerPaint);
    }

    drawCorner(
      Path()
        ..moveTo(left + corner, top)
        ..lineTo(left, top)
        ..lineTo(left, top + corner),
    );
    drawCorner(
      Path()
        ..moveTo(right - corner, top)
        ..lineTo(right, top)
        ..lineTo(right, top + corner),
    );
    drawCorner(
      Path()
        ..moveTo(left + corner, bottom)
        ..lineTo(left, bottom)
        ..lineTo(left, bottom - corner),
    );
    drawCorner(
      Path()
        ..moveTo(right - corner, bottom)
        ..lineTo(right, bottom)
        ..lineTo(right, bottom - corner),
    );
  }

  void _paintScanDots(Canvas canvas, Rect rect) {
    if (!active) return;

    const dotSpecs = [
      (x: 0.55, y: 0.14, r: 7.0, delay: 0.00),
      (x: 0.44, y: 0.34, r: 6.2, delay: 0.22),
      (x: 0.58, y: 0.52, r: 6.6, delay: 0.44),
      (x: 0.74, y: 0.72, r: 5.2, delay: 0.68),
    ];

    for (final spec in dotSpecs) {
      final t = (progress + spec.delay) % 1;
      final wave = sin(t * pi);
      final position = Offset(
        rect.left + rect.width * spec.x,
        rect.top + rect.height * ((spec.y + t * 0.16) % 0.86),
      );
      final radius = spec.r + wave * 2.6;
      final alpha = 0.22 + wave * 0.52;

      canvas.drawCircle(
        position,
        radius + 8,
        Paint()
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 12)
          ..color = Colors.white.withValues(alpha: alpha * 0.34),
      );
      canvas.drawCircle(
        position,
        radius,
        Paint()..color = Colors.white.withValues(alpha: alpha),
      );
    }
  }

  @override
  bool shouldRepaint(covariant SoleLensFramePainter oldDelegate) {
    return oldDelegate.active != active ||
        oldDelegate.frameRect != frameRect ||
        oldDelegate.progress != progress;
  }
}

class SoleLensStatusPill extends StatelessWidget {
  const SoleLensStatusPill({
    required this.text,
    required this.isLoading,
    super.key,
  });

  final String text;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 16, sigmaY: 16),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFF111725).withValues(alpha: 0.84),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (isLoading) ...[
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: 8),
              ],
              Flexible(
                child: Text(
                  text,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    height: 18 / 14,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SoleLensCaptureControls extends StatelessWidget {
  const SoleLensCaptureControls({
    required this.isTakingPhoto,
    required this.onCapture,
    super.key,
  });

  final bool isTakingPhoto;
  final VoidCallback onCapture;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SoleLensStatusPill(
          isLoading: false,
          text: '拍照搜索',
        ),
        const SizedBox(height: 14),
        GestureDetector(
          onTap: isTakingPhoto ? null : onCapture,
          child: Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 7),
              color: Colors.white.withValues(alpha: 0.12),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.24),
                  blurRadius: 24,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: Center(
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: isTakingPhoto ? 46 : 66,
                height: isTakingPhoto ? 46 : 66,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: Color(0xFFFF8D22),
                ),
                child: isTakingPhoto
                    ? const Padding(
                        padding: EdgeInsets.all(12),
                        child: CircularProgressIndicator(
                          strokeWidth: 3,
                          color: Colors.white,
                        ),
                      )
                    : null,
              ),
            ),
          ),
        ),
        const SizedBox(height: 8),
      ],
    );
  }
}

class SoleLensGallerySheet extends StatelessWidget {
  const SoleLensGallerySheet({
    required this.isPicking,
    required this.onPickGallery,
    super.key,
  });

  final bool isPicking;
  final VoidCallback onPickGallery;

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    return DraggableScrollableSheet(
      minChildSize: 0.16,
      initialChildSize: 0.18,
      maxChildSize: 0.34,
      snap: true,
      snapSizes: const [0.18, 0.34],
      builder: (context, scrollController) {
        return ClipRRect(
          borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
          child: BackdropFilter(
            filter: ui.ImageFilter.blur(sigmaX: 18, sigmaY: 18),
            child: Container(
              decoration: BoxDecoration(
                color: const Color(0xFF10141F).withValues(alpha: 0.94),
                border: Border(
                  top: BorderSide(
                    color: Colors.white.withValues(alpha: 0.12),
                  ),
                ),
              ),
              child: ListView(
                controller: scrollController,
                padding: EdgeInsets.fromLTRB(16, 10, 16, 18 + bottomPadding),
                children: [
                  Center(
                    child: Container(
                      width: 42,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.28),
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Material(
                    color: Colors.white.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(18),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(18),
                      onTap: isPicking ? null : onPickGallery,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 14, 14, 14),
                        child: Row(
                          children: [
                            Container(
                              width: 48,
                              height: 48,
                              decoration: BoxDecoration(
                                color: const Color(0xFFFFD37B)
                                    .withValues(alpha: 0.18),
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: const Color(0xFFFFD37B)
                                      .withValues(alpha: 0.36),
                                ),
                              ),
                              child: isPicking
                                  ? const Padding(
                                      padding: EdgeInsets.all(13),
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2.4,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Icon(
                                      Icons.photo_library_rounded,
                                      color: Color(0xFFFFD37B),
                                    ),
                            ),
                            const SizedBox(width: 13),
                            const Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '从相册上传',
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 18,
                                      height: 23 / 18,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                  SizedBox(height: 3),
                                  Text(
                                    '选择已有商品图继续搜索',
                                    style: TextStyle(
                                      color: Color(0xFFB8BFCC),
                                      fontSize: 13,
                                      height: 18 / 13,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const Icon(
                              Icons.keyboard_arrow_right_rounded,
                              color: Colors.white,
                              size: 28,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class RequirementSubmitter {
  RequirementSubmitter({
    required this.apiBaseUrl,
    required this.backendEnabled,
  }) : _api = ShoppingApiClient(baseUrl: apiBaseUrl);

  final String apiBaseUrl;
  final bool backendEnabled;
  final ShoppingApiClient _api;
  String? _lastFailureMessage;
  ProductSearchPipelineMode searchPipelineMode =
      ProductSearchPipelineMode.lightTagAnnFusion;

  bool get canSyncUserProfile => backendEnabled;

  Map<String, dynamic> get _pipelineFilter => {
        'searchPipelineMode': searchPipelineMode.apiValue,
      };

  String get lastFailureMessage => _lastFailureMessage ?? '暂时无法连接服务，请稍后重试。';

  void _clearFailure() {
    _lastFailureMessage = null;
  }

  void _recordBackendDisabled() {
    _lastFailureMessage = '当前是本地 UI 预览模式，重新使用云端参数启动后即可继续对话。';
  }

  void _recordFailure(Object error) {
    if (error is ShoppingApiException) {
      if (error.code == 'SESSION_NOT_FOUND') {
        _lastFailureMessage = '这条历史会话已失效，请新建对话后继续。';
        return;
      }
      if (error.code.startsWith('AUTH_')) {
        _lastFailureMessage = '登录状态已失效，正在等待重新连接。';
        return;
      }
      if (error.code == 'MODEL_PROVIDER_REQUEST_FAILED') {
        _lastFailureMessage = '后端模型服务暂时失败，本次图片搜索没有完成。';
        return;
      }
      _lastFailureMessage = '服务暂时无法处理这条消息，请稍后重试。';
      return;
    }
    if (error is TimeoutException) {
      _lastFailureMessage = '服务响应超时，请稍后重试。';
      return;
    }
    if (error is SocketException) {
      _lastFailureMessage = '当前网络不可用，请检查网络后重试。';
      return;
    }
    _lastFailureMessage = '暂时无法连接服务，请稍后重试。';
  }

  Future<List<DemoCandidate>?> submitInitialRequirement(String text) async {
    debugPrint('submit initial requirement to $apiBaseUrl: $text');
    if (!backendEnabled) {
      _recordBackendDisabled();
      return null;
    }
    _clearFailure();
    try {
      final candidates = await _api.searchShoesByText(text);
      return _toDemoCandidates(candidates);
    } catch (error) {
      debugPrint('text search request failed: $error');
      _recordFailure(error);
      return null;
    }
  }

  Future<RemoteSessionDraft?> createSessionFromText(String text) async {
    debugPrint('create text session at $apiBaseUrl: $text');
    if (!backendEnabled) {
      _recordBackendDisabled();
      return null;
    }
    _clearFailure();
    try {
      final session = await _api.createTextSession(
        message: text,
        filters: _pipelineFilter,
      );
      if (session.sessionId.isEmpty) return null;
      searchPipelineMode = session.searchPipelineMode;
      final candidates = await _api.getCandidates(session.sessionId);
      return RemoteSessionDraft(
        sessionId: session.sessionId,
        candidates: _toDemoCandidates(candidates.items),
        nextCursor: candidates.nextCursor,
        hasMore: candidates.hasMore,
        assistantMessage: session.assistantMessage,
        intent: session.intent,
        stateChangingTurn: session.stateChangingTurn,
        productProfile: session.productProfile,
        searchPipelineMode: session.searchPipelineMode,
      );
    } catch (error) {
      debugPrint('text session request failed: $error');
      _recordFailure(error);
      return null;
    }
  }

  Future<RemoteSessionDraft?> createSessionFromImage({
    required File imageFile,
    required ImageSource source,
    RecognitionImageSelection? selection,
  }) async {
    if (!backendEnabled) {
      _recordBackendDisabled();
      return null;
    }
    _clearFailure();
    try {
      final asset = await _api.uploadImage(
        imageFile: imageFile,
        sourceType: source == ImageSource.camera ? 'camera' : 'album',
      );
      final session = await _api.createSession(
        assetId: asset.assetId,
        filters: _pipelineFilter,
        initialSubjectSelection: selection == null
            ? null
            : ApiSubjectSelection(
                left: selection.left,
                top: selection.top,
                width: selection.width,
                height: selection.height,
              ),
      );
      if (session.sessionId.isEmpty) return null;
      searchPipelineMode = session.searchPipelineMode;
      final candidates = await _api.getCandidates(session.sessionId);
      return RemoteSessionDraft(
        sessionId: session.sessionId,
        candidates: _toDemoCandidates(candidates.items),
        nextCursor: candidates.nextCursor,
        hasMore: candidates.hasMore,
        productProfile: session.productProfile,
        detailedProfileStatus: session.detailedProfileStatus,
        searchPipelineMode: session.searchPipelineMode,
      );
    } catch (error) {
      debugPrint('image session request failed: $error');
      _recordFailure(error);
      return null;
    }
  }

  Future<RemoteRefineResult?> refineCandidates({
    required String sessionId,
  }) async {
    debugPrint('refine candidates $sessionId at $apiBaseUrl');
    if (!backendEnabled || sessionId.startsWith('LOCAL-')) return null;
    try {
      final refine = await _api.refineCandidates(sessionId);
      if (!refine.isReady) {
        return RemoteRefineResult(
          status: refine.status,
          candidates: const [],
          nextCursor: null,
          hasMore: false,
          productProfile: refine.productProfile,
        );
      }
      final candidates = await _api.getCandidates(sessionId);
      return RemoteRefineResult(
        status: refine.status,
        candidates: _toDemoCandidates(candidates.items),
        nextCursor: candidates.nextCursor,
        hasMore: candidates.hasMore,
        productProfile: refine.productProfile,
      );
    } catch (error) {
      debugPrint('refine candidates request failed: $error');
      return null;
    }
  }

  Future<RemoteCandidatePage?> updateSubjectSelection({
    required String sessionId,
    required RecognitionImageSelection selection,
  }) async {
    debugPrint('update subject selection $sessionId at $apiBaseUrl');
    if (!backendEnabled || sessionId.startsWith('LOCAL-')) return null;
    try {
      await _api.updateSubjectSelection(
        sessionId: sessionId,
        left: selection.left,
        top: selection.top,
        width: selection.width,
        height: selection.height,
      );
      final candidates = await _api.getCandidates(sessionId);
      return RemoteCandidatePage(
        candidates: _toDemoCandidates(candidates.items),
        nextCursor: candidates.nextCursor,
        hasMore: candidates.hasMore,
      );
    } catch (error) {
      debugPrint('subject selection request failed: $error');
      return null;
    }
  }

  Future<List<DemoCandidate>?> submitSessionTurn({
    required String sessionId,
    required String text,
  }) async {
    final page = await submitSessionTurnPage(sessionId: sessionId, text: text);
    if (page == null || !page.stateChangingTurn) return null;
    return page.candidates;
  }

  Future<RemoteCandidatePage?> submitSessionTurnPage({
    required String sessionId,
    required String text,
  }) async {
    debugPrint('submit session turn $sessionId to $apiBaseUrl: $text');
    if (!backendEnabled || sessionId.startsWith('LOCAL-')) {
      _recordBackendDisabled();
      return null;
    }
    _clearFailure();
    try {
      final turn = await _api.submitTurn(
        sessionId: sessionId,
        message: text,
        filters: _pipelineFilter,
      );
      final candidates = turn.candidates;
      return RemoteCandidatePage(
        candidates: _toDemoCandidates(candidates.items),
        nextCursor: candidates.nextCursor,
        hasMore: candidates.hasMore,
        assistantMessage: turn.assistantMessage,
        intent: turn.intent,
        stateChangingTurn: turn.stateChangingTurn,
      );
    } catch (error) {
      debugPrint('turn request failed: $error');
      _recordFailure(error);
      return null;
    }
  }

  Future<RemoteCandidatePage?> updateProductProfile({
    required String sessionId,
    required BackendProductProfile profile,
  }) async {
    debugPrint('update product profile $sessionId at $apiBaseUrl');
    if (!backendEnabled || sessionId.startsWith('LOCAL-')) return null;
    try {
      final session = await _api.updateProductProfile(
        sessionId: sessionId,
        profile: profile,
        filters: _pipelineFilter,
      );
      searchPipelineMode = session.searchPipelineMode;
      final candidates = await _api.getCandidates(sessionId);
      return RemoteCandidatePage(
        candidates: _toDemoCandidates(candidates.items),
        nextCursor: candidates.nextCursor,
        hasMore: candidates.hasMore,
        productProfile: session.productProfile,
        searchPipelineMode: session.searchPipelineMode,
        stateChangingTurn: true,
      );
    } catch (error) {
      debugPrint('profile update request failed: $error');
      _recordFailure(error);
      return null;
    }
  }

  Future<RemoteCandidatePage?> fetchMoreCandidates({
    required String sessionId,
    String? cursor,
    int limit = 30,
  }) async {
    debugPrint('fetch more candidates $sessionId from $apiBaseUrl');
    if (!backendEnabled || sessionId.startsWith('LOCAL-')) return null;
    try {
      final candidates = await _api.getMoreCandidates(
        sessionId: sessionId,
        cursor: cursor,
        limit: limit,
      );
      return RemoteCandidatePage(
        candidates: _toDemoCandidates(candidates.items),
        nextCursor: candidates.nextCursor,
        hasMore: candidates.hasMore,
      );
    } catch (error) {
      debugPrint('more candidates request failed: $error');
      return null;
    }
  }

  Future<List<DemoCandidate>?> submitVoiceSearch(String text) async {
    debugPrint('submit voice search to $apiBaseUrl: $text');
    return submitInitialRequirement(text);
  }

  Future<Map<String, dynamic>?> fetchCandidateDetail(
    String candidateItemId,
  ) async {
    debugPrint('fetch candidate detail from $apiBaseUrl: $candidateItemId');
    if (!backendEnabled) {
      return null;
    }
    try {
      return await _api.getCandidateDetail(candidateItemId);
    } catch (error) {
      debugPrint('candidate detail request failed: $error');
      return null;
    }
  }

  Future<void> shortlistCandidateForTrendOutfit({
    required String sessionId,
    required DemoCandidate candidate,
  }) async {
    debugPrint(
      'shortlist candidate for trend outfit at $apiBaseUrl: ${candidate.candidateItemId}',
    );
    if (!backendEnabled || sessionId.startsWith('LOCAL-')) {
      return;
    }
    try {
      await _api.shortlistCandidate(
        sessionId: sessionId,
        candidateItemId: candidate.candidateItemId,
        source: 'mobile_left_swipe',
        limit: 4,
      );
    } catch (error) {
      debugPrint('candidate shortlist request failed: $error');
    }
  }

  Future<List<DemoCandidate>?> fetchSessionCart({
    required String sessionId,
  }) async {
    debugPrint('fetch session cart from $apiBaseUrl: $sessionId');
    if (!backendEnabled || sessionId.startsWith('LOCAL-')) return null;
    try {
      final cart = await _api.getSessionCart(sessionId);
      return _toDemoCandidates(cart.items);
    } catch (error) {
      debugPrint('session cart request failed: $error');
      return null;
    }
  }

  Future<void> removeCartCandidate({
    required String sessionId,
    required DemoCandidate candidate,
  }) async {
    debugPrint(
      'remove cart candidate at $apiBaseUrl: ${candidate.candidateItemId}',
    );
    if (!backendEnabled || sessionId.startsWith('LOCAL-')) return;
    try {
      await _api.removeCartCandidate(
        sessionId: sessionId,
        candidateItemId: candidate.candidateItemId,
      );
    } catch (error) {
      debugPrint('remove cart candidate request failed: $error');
    }
  }

  Future<TrendOutfitDraft?> fetchTrendOutfitRecommendations({
    required String sessionId,
    required DemoCandidate candidate,
  }) async {
    debugPrint(
      'fetch trend outfit at $apiBaseUrl: ${candidate.candidateItemId}',
    );
    if (!backendEnabled || sessionId.startsWith('LOCAL-')) return null;
    try {
      final data = await _api.getTrendOutfitRecommendations(
        sessionId: sessionId,
        candidateItemId: candidate.candidateItemId,
        limit: 4,
      );
      return TrendOutfitDraft.fromJson(data);
    } catch (error) {
      debugPrint('trend outfit request failed: $error');
      return null;
    }
  }

  Future<SoftBackendSuggestionDraft?> fetchSessionSuggestions(
    String sessionId,
  ) async {
    debugPrint('fetch session suggestions from $apiBaseUrl: $sessionId');
    if (!backendEnabled || sessionId.startsWith('LOCAL-')) return null;
    try {
      final response = await _api.getSuggestions(sessionId);
      return SoftBackendSuggestionDraft.fromResponse(response);
    } catch (error) {
      debugPrint('session suggestions request failed: $error');
      return null;
    }
  }

  Future<String> submitAssistantQuestion(String question) async {
    // TODO: Replace with an app-help LLM endpoint.
    debugPrint('submit assistant question to $apiBaseUrl: $question');
    return '我先按本地说明回答：你可以拍照检索，也可以直接说出商品样貌、型号和预算来搜索。';
  }

  Future<UserProfileResponse?> fetchUserProfile() async {
    debugPrint('fetch user profile from $apiBaseUrl');
    if (!backendEnabled) {
      _recordBackendDisabled();
      return UserProfileResponse.empty();
    }
    try {
      return await _api.getUserProfile();
    } catch (error) {
      debugPrint('user profile fetch failed: $error');
      _recordFailure(error);
      return null;
    }
  }

  Future<UserProfileBlock?> saveUserProfileBlock({
    required String? blockId,
    required String blockType,
    required String scope,
    required Map<String, dynamic> payload,
    required String sensitivity,
  }) async {
    if (!backendEnabled) {
      _recordBackendDisabled();
      return null;
    }
    try {
      if (blockId == null || blockId.isEmpty) {
        return await _api.createUserProfileBlock(
          blockType: blockType,
          scope: scope,
          payload: payload,
          sensitivity: sensitivity,
        );
      }
      return await _api.updateUserProfileBlock(
        blockId: blockId,
        blockType: blockType,
        scope: scope,
        payload: payload,
        sensitivity: sensitivity,
      );
    } catch (error) {
      debugPrint('user profile block save failed: $error');
      _recordFailure(error);
      return null;
    }
  }

  Future<bool> deleteUserProfileBlock(String? blockId) async {
    if (blockId == null || blockId.isEmpty) return true;
    if (!backendEnabled) {
      _recordBackendDisabled();
      return false;
    }
    try {
      await _api.deleteUserProfileBlock(blockId);
      return true;
    } catch (error) {
      debugPrint('user profile block delete failed: $error');
      _recordFailure(error);
      return false;
    }
  }

  Future<void> saveShoeSizePreference(String shoeSize) async {
    debugPrint('save shoe size preference to $apiBaseUrl: $shoeSize');
    if (!backendEnabled) return;
    try {
      await _api.saveShoeSizePreference(shoeSize: shoeSize);
    } catch (error) {
      debugPrint('shoe size preference save failed: $error');
    }
  }

  List<DemoCandidate> _toDemoCandidates(List<BackendCandidateItem> items) {
    const accents = [
      Color(0xFF8BFFD9),
      Color(0xFF9DBBFF),
      Color(0xFFFFC2CA),
      Color(0xFFFFD37B),
      Color(0xFFFFA4D3),
    ];

    return [
      for (var index = 0; index < items.length; index += 1)
        _toDemoCandidate(items[index], accents[index % accents.length]),
    ];
  }

  DemoCandidate _toDemoCandidate(BackendCandidateItem item, Color accent) {
    final matchScore = _scoreFromSummary(item.matchSummary);
    final commerceMeta = item.commerceMeta;
    final rating =
        _ratingFromCommerce(commerceMeta) ?? _ratingFromScore(matchScore);
    final deliveryDays = _deliveryDaysFromCommerce(commerceMeta);
    final material = item.normalizedAttributes['material']?.toString() ??
        item.normalizedAttributes['upperMaterial']?.toString() ??
        item.normalizedAttributes['shoeType']?.toString() ??
        '材质待确认';
    final reason = item.recommendationReason.isNotEmpty
        ? item.recommendationReason.first
        : '后端候选';
    final decisionTags = item.decisionTags.isNotEmpty
        ? item.decisionTags
        : [
            if (item.stockStatus == 'in_stock') '有货',
            '匹配 ${(matchScore * 100).round()}%',
          ];

    return DemoCandidate(
      candidateItemId: item.candidateItemId,
      title: item.title,
      platform: item.platformName,
      amount: item.amount,
      brand: item.normalizedAttributes['brand']?.toString(),
      shopName: item.shopName,
      shopType: item.shopType,
      imageUrl: item.coverImageUrl,
      productUrl: item.productUrl,
      platformProductId: item.platformProductId,
      platformBrandId: item.platformBrandId,
      stockStatus: _stockStatusFromBackend(item.stockStatus),
      reason: reason,
      matchScore: matchScore,
      rating: rating,
      material: material,
      materialScore: (matchScore * 85 + 8).clamp(60, 96),
      breathabilityScore: 76,
      dailyScore: (matchScore * 80 + 12).clamp(58, 95),
      deliveryDaysOverride: deliveryDays,
      decisionTags: decisionTags,
      detailBullets: _detailBullets(item, matchScore),
      productPoolData: _productPoolData(item),
      accentColor: accent,
    );
  }

  Map<String, dynamic> _productPoolData(BackendCandidateItem item) {
    return {
      'candidateItemId': item.candidateItemId,
      'title': item.title,
      'platformName': item.platformName,
      'price': {
        'amount': item.amount,
        'currency': item.currency,
      },
      'shopName': item.shopName,
      'shopType': item.shopType,
      'stockStatus': item.stockStatus,
      'coverImageUrl': item.coverImageUrl,
      'productUrl': item.productUrl,
      'platformProductId': item.platformProductId,
      'platformBrandId': item.platformBrandId,
      'matchSummary': item.matchSummary,
      'normalizedAttributes': item.normalizedAttributes,
      'commerceMeta': item.commerceMeta,
      'sortSignals': item.sortSignals,
      'rawPayload': item.rawPayload,
      'recommendationReason': item.recommendationReason,
      'decisionTags': item.decisionTags,
      'decisionSupport': item.decisionSupport,
    };
  }

  List<String> _detailBullets(BackendCandidateItem item, double matchScore) {
    final support = item.decisionSupport;
    return [
      if (item.recommendationReason.isNotEmpty) item.recommendationReason.first,
      if (support['priceConclusion'] != null)
        support['priceConclusion'].toString()
      else
        '后端返回价格 ${item.amount.toStringAsFixed(0)} ${item.currency}。',
      if (support['stockConclusion'] != null)
        support['stockConclusion'].toString()
      else
        '匹配度约 ${(matchScore * 100).round()}%，库存状态为 ${item.stockStatus}。',
    ];
  }

  StockStatus _stockStatusFromBackend(String value) {
    return switch (value) {
      'in_stock' => StockStatus.inStock,
      'out_of_stock' => StockStatus.outOfStock,
      _ => StockStatus.unknown,
    };
  }

  double _scoreFromSummary(Map<String, dynamic> summary) {
    final raw = summary['displayScore'] ??
        summary['matchScore'] ??
        summary['visualMatchConfidence'] ??
        summary['annScore'] ??
        summary['score'];
    if (raw is num) return raw.toDouble().clamp(0, 1);
    if (raw is String) return (double.tryParse(raw) ?? 0.82).clamp(0, 1);
    return 0.82;
  }

  double _ratingFromScore(double score) {
    return (3.8 + score.clamp(0, 1) * 1.1).clamp(3.8, 4.9);
  }

  double? _ratingFromCommerce(Map<String, dynamic> commerceMeta) {
    final rating = _asNestedMap(commerceMeta, 'rating')['overall'];
    if (rating is num) return rating.toDouble().clamp(0, 5).toDouble();
    if (rating is String) {
      return double.tryParse(rating)?.clamp(0, 5).toDouble();
    }
    return null;
  }

  int? _deliveryDaysFromCommerce(Map<String, dynamic> commerceMeta) {
    final deliveryDays = _asNestedMap(commerceMeta, 'delivery')['deliveryDays'];
    if (deliveryDays is num) return deliveryDays.round();
    if (deliveryDays is String) return int.tryParse(deliveryDays);
    return null;
  }

  Map<String, dynamic> _asNestedMap(Map<String, dynamic> source, String key) {
    final value = source[key];
    if (value is Map<String, dynamic>) return value;
    if (value is Map) {
      return value.map((key, item) => MapEntry(key.toString(), item));
    }
    return const {};
  }
}

class RemoteSessionDraft {
  const RemoteSessionDraft({
    required this.sessionId,
    required this.candidates,
    this.nextCursor,
    this.hasMore = true,
    this.assistantMessage,
    this.intent,
    this.productProfile,
    this.detailedProfileStatus,
    this.searchPipelineMode = ProductSearchPipelineMode.lightTagAnnFusion,
    this.stateChangingTurn = true,
  });

  final String sessionId;
  final List<DemoCandidate> candidates;
  final String? nextCursor;
  final bool hasMore;
  final String? assistantMessage;
  final String? intent;
  final BackendProductProfile? productProfile;
  final String? detailedProfileStatus;
  final ProductSearchPipelineMode searchPipelineMode;
  final bool stateChangingTurn;
}

class RemoteCandidatePage {
  const RemoteCandidatePage({
    required this.candidates,
    required this.nextCursor,
    required this.hasMore,
    this.assistantMessage,
    this.intent,
    this.productProfile,
    this.searchPipelineMode = ProductSearchPipelineMode.lightTagAnnFusion,
    this.stateChangingTurn = true,
  });

  final List<DemoCandidate> candidates;
  final String? nextCursor;
  final bool hasMore;
  final String? assistantMessage;
  final String? intent;
  final BackendProductProfile? productProfile;
  final ProductSearchPipelineMode searchPipelineMode;
  final bool stateChangingTurn;
}

class RemoteRefineResult {
  const RemoteRefineResult({
    required this.status,
    required this.candidates,
    required this.nextCursor,
    required this.hasMore,
    this.productProfile,
  });

  final String status;
  final List<DemoCandidate> candidates;
  final String? nextCursor;
  final bool hasMore;
  final BackendProductProfile? productProfile;

  bool get isPending => status == 'tag_pending';
  bool get isReady => status == 'ready' || status == 'degraded_ready';
  bool get isFailed => status == 'tag_failed';
}

class TrendOutfitDraft {
  const TrendOutfitDraft({
    required this.trendSummary,
    required this.outfitAdvice,
    required this.recommendations,
    required this.fallback,
  });

  final String trendSummary;
  final List<String> outfitAdvice;
  final List<TrendOutfitProductDraft> recommendations;
  final bool fallback;

  factory TrendOutfitDraft.fromJson(Map<String, dynamic> json) {
    final recommendations = _jsonList(json['recommendations'])
        .map((item) => TrendOutfitProductDraft.fromJson(_softMap(item)))
        .where((item) => item.title.isNotEmpty)
        .toList(growable: false);
    final outfitAdvice = _jsonList(json['outfitAdvice'])
        .map((item) => item.toString().trim())
        .where((item) => item.isNotEmpty)
        .toList(growable: false);
    return TrendOutfitDraft(
      trendSummary: json['trendSummary']?.toString() ?? '',
      outfitAdvice: outfitAdvice,
      recommendations: recommendations,
      fallback: json['fallback'] == true,
    );
  }
}

class TrendOutfitProductDraft {
  const TrendOutfitProductDraft({
    required this.productId,
    required this.title,
    required this.category,
    required this.price,
    required this.imageUrl,
    required this.productUrl,
    required this.reason,
    required this.displayCategory,
  });

  final String productId;
  final String title;
  final String category;
  final double price;
  final String imageUrl;
  final String productUrl;
  final String reason;
  final String displayCategory;

  factory TrendOutfitProductDraft.fromJson(Map<String, dynamic> json) {
    final matchedTrend = _softMap(json['matchedTrend']);
    return TrendOutfitProductDraft(
      productId: json['productId']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      category: json['category']?.toString() ?? '',
      price: _detailNumber(json['price']) ?? 0,
      imageUrl: json['imageUrl']?.toString() ?? '',
      productUrl: json['productUrl']?.toString() ?? '',
      reason: json['reason']?.toString() ?? '',
      displayCategory: matchedTrend['displayCategory']?.toString() ??
          json['category']?.toString() ??
          '',
    );
  }
}

class SessionShoppingCartStore extends ChangeNotifier {
  final Map<String, List<DemoCandidate>> _itemsBySession =
      <String, List<DemoCandidate>>{};
  final Set<String> _refreshingSessionIds = <String>{};
  final Set<String> _writingCandidateKeys = <String>{};

  List<DemoCandidate> itemsFor(String? sessionId) {
    final normalized = _normalizeSessionId(sessionId);
    if (normalized == null) return const [];
    return List.unmodifiable(_itemsBySession[normalized] ?? const []);
  }

  int countFor(String? sessionId) => itemsFor(sessionId).length;

  bool isRefreshing(String? sessionId) {
    final normalized = _normalizeSessionId(sessionId);
    return normalized != null && _refreshingSessionIds.contains(normalized);
  }

  void seedSession(String? sessionId, Iterable<DemoCandidate> candidates) {
    final normalized = _normalizeSessionId(sessionId);
    if (normalized == null) return;
    final current = [...?_itemsBySession[normalized]];
    var changed = false;
    for (final candidate in candidates) {
      if (_putCandidate(current, candidate)) changed = true;
    }
    if (!changed) return;
    _itemsBySession[normalized] = current;
    notifyListeners();
  }

  Future<void> refreshSession(String? sessionId) async {
    final normalized = _normalizeSessionId(sessionId);
    if (normalized == null ||
        normalized.startsWith('LOCAL-') ||
        _refreshingSessionIds.contains(normalized)) {
      return;
    }
    _refreshingSessionIds.add(normalized);
    notifyListeners();
    try {
      final items = await requirementSubmitter.fetchSessionCart(
        sessionId: normalized,
      );
      if (items != null) {
        _itemsBySession[normalized] = items;
      }
    } finally {
      _refreshingSessionIds.remove(normalized);
      notifyListeners();
    }
  }

  Future<void> addCandidate({
    required String sessionId,
    required DemoCandidate candidate,
  }) async {
    final normalized = _normalizeSessionId(sessionId);
    if (normalized == null) return;
    final current = [...?_itemsBySession[normalized]];
    final changed = _putCandidate(current, candidate);
    _itemsBySession[normalized] = current;
    if (changed) notifyListeners();

    final writeKey = '$normalized:${candidate.candidateItemId}';
    if (!_writingCandidateKeys.add(writeKey)) return;
    try {
      await requirementSubmitter.shortlistCandidateForTrendOutfit(
        sessionId: normalized,
        candidate: candidate,
      );
      await refreshSession(normalized);
    } finally {
      _writingCandidateKeys.remove(writeKey);
    }
  }

  Future<void> removeCandidate({
    required String sessionId,
    required DemoCandidate candidate,
  }) async {
    final normalized = _normalizeSessionId(sessionId);
    if (normalized == null) return;
    final current = [...?_itemsBySession[normalized]];
    final before = current.length;
    current.removeWhere(
      (item) => item.candidateItemId == candidate.candidateItemId,
    );
    _itemsBySession[normalized] = current;
    if (current.length != before) notifyListeners();
    await requirementSubmitter.removeCartCandidate(
      sessionId: normalized,
      candidate: candidate,
    );
  }

  bool _putCandidate(List<DemoCandidate> target, DemoCandidate candidate) {
    final candidateId = candidate.candidateItemId;
    if (candidateId.isEmpty ||
        target.any((item) => item.candidateItemId == candidateId)) {
      return false;
    }
    target.add(candidate);
    return true;
  }

  String? _normalizeSessionId(String? sessionId) {
    final normalized = sessionId?.trim();
    return normalized == null || normalized.isEmpty ? null : normalized;
  }
}

class UserPreferenceMemory {
  static String? shoeSize;
}

class EditableUserProfileDraft {
  EditableUserProfileDraft({
    this.identityBlockId,
    this.sizeBlockId,
    this.categoryBlockId,
    this.platformBlockId,
    this.shoppingBlockId,
    this.interactionBlockId,
    this.nickname = '',
    this.city = '',
    this.shoeSize = '',
    this.favoriteBrands = '',
    this.preferredStyles = '',
    Set<String>? excludedPlatformIds,
    this.decisionPriority,
    this.responseStyle,
  }) : excludedPlatformIds = {...?excludedPlatformIds};

  final String? identityBlockId;
  final String? sizeBlockId;
  final String? categoryBlockId;
  final String? platformBlockId;
  final String? shoppingBlockId;
  final String? interactionBlockId;
  final String nickname;
  final String city;
  final String shoeSize;
  final String favoriteBrands;
  final String preferredStyles;
  final Set<String> excludedPlatformIds;
  final String? decisionPriority;
  final String? responseStyle;

  factory EditableUserProfileDraft.fromProfile(UserProfileResponse profile) {
    final identity = profile.findBlock('identity_basic', 'global');
    final size = profile.findBlock('size_profile', 'shoe');
    final category = profile.findBlock('category_preferences', 'shoe');
    final platform = profile.findBlock('platform_preferences', 'global');
    final shopping = profile.findBlock('shopping_preferences', 'global');
    final interaction = profile.findBlock('interaction_preferences', 'global');

    return EditableUserProfileDraft(
      identityBlockId: identity?.blockId,
      sizeBlockId: size?.blockId,
      categoryBlockId: category?.blockId,
      platformBlockId: platform?.blockId,
      shoppingBlockId: shopping?.blockId,
      interactionBlockId: interaction?.blockId,
      nickname: _stringField(identity?.payload, 'nickname'),
      city: _stringField(identity?.payload, 'city'),
      shoeSize: _stringField(size?.payload, 'shoeSize'),
      favoriteBrands: _joinListField(category?.payload, 'favoriteBrands'),
      preferredStyles: _joinListField(category?.payload, 'preferredStyles'),
      excludedPlatformIds: _stringListField(
        platform?.payload,
        'excludedPlatforms',
      ).toSet(),
      decisionPriority: _nullableStringField(
        shopping?.payload,
        'decisionPriority',
      ),
      responseStyle: _nullableStringField(
        interaction?.payload,
        'responseStyle',
      ),
    );
  }

  Map<String, dynamic> identityPayload() => _compactPayload({
        'nickname': nickname.trim(),
        'city': city.trim(),
      });

  Map<String, dynamic> sizePayload() => _compactPayload({
        'shoeSize': shoeSize.trim(),
      });

  Map<String, dynamic> categoryPayload() => _compactPayload({
        'favoriteBrands': _splitList(favoriteBrands),
        'preferredStyles': _splitList(preferredStyles),
      });

  Map<String, dynamic> platformPayload() => _compactPayload({
        'excludedPlatforms': excludedPlatformIds.toList(growable: false),
      });

  Map<String, dynamic> shoppingPayload() => _compactPayload({
        'decisionPriority': decisionPriority,
      });

  Map<String, dynamic> interactionPayload() => _compactPayload({
        'responseStyle': responseStyle,
      });

  static String _stringField(Map<String, dynamic>? payload, String key) {
    return _nullableStringField(payload, key) ?? '';
  }

  static String? _nullableStringField(
    Map<String, dynamic>? payload,
    String key,
  ) {
    final value = payload?[key]?.toString().trim();
    return value == null || value.isEmpty ? null : value;
  }

  static List<String> _stringListField(
    Map<String, dynamic>? payload,
    String key,
  ) {
    final value = payload?[key];
    if (value is List) {
      return [
        for (final item in value)
          if (item.toString().trim().isNotEmpty) item.toString().trim(),
      ];
    }
    final text = value?.toString().trim();
    if (text == null || text.isEmpty) return const [];
    return _splitList(text);
  }

  static String _joinListField(Map<String, dynamic>? payload, String key) {
    return _stringListField(payload, key).join('、');
  }

  static List<String> _splitList(String text) {
    final seen = <String>{};
    return text
        .split(RegExp(r'[,，、\s]+'))
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty && seen.add(item))
        .toList(growable: false);
  }

  static Map<String, dynamic> _compactPayload(Map<String, Object?> input) {
    final output = <String, dynamic>{};
    input.forEach((key, value) {
      if (value == null) return;
      if (value is String) {
        final normalized = value.trim();
        if (normalized.isNotEmpty) output[key] = normalized;
        return;
      }
      if (value is List && value.isNotEmpty) {
        output[key] = value;
        return;
      }
      if (value is bool || value is num) output[key] = value;
    });
    return output;
  }
}

class UserProfileEditorSheet extends StatefulWidget {
  const UserProfileEditorSheet({
    required this.submitter,
    super.key,
  });

  final RequirementSubmitter submitter;

  @override
  State<UserProfileEditorSheet> createState() => _UserProfileEditorSheetState();
}

class _UserProfileEditorSheetState extends State<UserProfileEditorSheet> {
  static const _platformOptions = [
    _ProfilePlatformOption('taobao', '淘宝'),
    _ProfilePlatformOption('tmall', '天猫'),
    _ProfilePlatformOption('jd', '京东'),
    _ProfilePlatformOption('dewu', '得物'),
    _ProfilePlatformOption('pdd', '拼多多'),
    _ProfilePlatformOption('douyin', '抖音'),
  ];

  static const _decisionPriorityOptions = [
    ProfileSelectOption('price', '价格优先'),
    ProfileSelectOption('speed', '发货速度'),
    ProfileSelectOption('authenticity', '正品保障'),
    ProfileSelectOption('store_trust', '店铺可信度'),
    ProfileSelectOption('visual_match', '外观匹配'),
  ];

  static const _responseStyleOptions = [
    ProfileSelectOption('concise', '简洁'),
    ProfileSelectOption('detailed', '详细'),
  ];

  final _nicknameController = TextEditingController();
  final _cityController = TextEditingController();
  final _shoeSizeController = TextEditingController();
  final _favoriteBrandsController = TextEditingController();
  final _preferredStylesController = TextEditingController();

  UserProfileResponse? _profile;
  EditableUserProfileDraft _draft = EditableUserProfileDraft();
  Set<String> _excludedPlatformIds = {};
  String? _decisionPriority;
  String? _responseStyle;
  bool _loading = true;
  bool _saving = false;
  String? _errorMessage;

  bool get _canSync => widget.submitter.canSyncUserProfile;

  @override
  void initState() {
    super.initState();
    unawaited(_loadProfile());
  }

  @override
  void dispose() {
    _nicknameController.dispose();
    _cityController.dispose();
    _shoeSizeController.dispose();
    _favoriteBrandsController.dispose();
    _preferredStylesController.dispose();
    super.dispose();
  }

  Future<void> _loadProfile() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    final profile = await widget.submitter.fetchUserProfile();
    if (!mounted) return;
    if (profile == null) {
      setState(() {
        _loading = false;
        _errorMessage = widget.submitter.lastFailureMessage;
      });
      return;
    }
    _profile = profile;
    _draft = EditableUserProfileDraft.fromProfile(profile);
    _applyDraftToControllers(_draft);
    setState(() {
      _loading = false;
      _errorMessage = _canSync ? null : widget.submitter.lastFailureMessage;
    });
  }

  void _applyDraftToControllers(EditableUserProfileDraft draft) {
    _nicknameController.text = draft.nickname;
    _cityController.text = draft.city;
    _shoeSizeController.text = draft.shoeSize;
    _favoriteBrandsController.text = draft.favoriteBrands;
    _preferredStylesController.text = draft.preferredStyles;
    _excludedPlatformIds = {...draft.excludedPlatformIds};
    _decisionPriority = _normalizeSelectValue(
      draft.decisionPriority,
      _decisionPriorityOptions,
    );
    _responseStyle = _normalizeSelectValue(
      draft.responseStyle,
      _responseStyleOptions,
    );
  }

  String? _normalizeSelectValue(
    String? value,
    List<ProfileSelectOption> options,
  ) {
    if (value == null || value.trim().isEmpty) return null;
    for (final option in options) {
      if (option.value == value) return value;
    }
    return null;
  }

  EditableUserProfileDraft _draftFromInputs() {
    return EditableUserProfileDraft(
      identityBlockId: _draft.identityBlockId,
      sizeBlockId: _draft.sizeBlockId,
      categoryBlockId: _draft.categoryBlockId,
      platformBlockId: _draft.platformBlockId,
      shoppingBlockId: _draft.shoppingBlockId,
      interactionBlockId: _draft.interactionBlockId,
      nickname: _nicknameController.text,
      city: _cityController.text,
      shoeSize: _shoeSizeController.text,
      favoriteBrands: _favoriteBrandsController.text,
      preferredStyles: _preferredStylesController.text,
      excludedPlatformIds: _excludedPlatformIds,
      decisionPriority: _decisionPriority,
      responseStyle: _responseStyle,
    );
  }

  Future<void> _saveProfile() async {
    if (!_canSync || _saving) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _errorMessage = null;
    });

    final draft = _draftFromInputs();
    final ok = await _syncBlock(
          blockId: draft.identityBlockId,
          blockType: 'identity_basic',
          scope: 'global',
          sensitivity: 'low',
          payload: _mergedBlockPayload(
            blockType: 'identity_basic',
            scope: 'global',
            edits: draft.identityPayload(),
            controlledKeys: const {'nickname', 'city'},
          ),
        ) &&
        await _syncBlock(
          blockId: draft.sizeBlockId,
          blockType: 'size_profile',
          scope: 'shoe',
          sensitivity: 'high',
          payload: _mergedBlockPayload(
            blockType: 'size_profile',
            scope: 'shoe',
            edits: draft.sizePayload(),
            controlledKeys: const {'shoeSize'},
          ),
        ) &&
        await _syncBlock(
          blockId: draft.categoryBlockId,
          blockType: 'category_preferences',
          scope: 'shoe',
          sensitivity: 'low',
          payload: _mergedBlockPayload(
            blockType: 'category_preferences',
            scope: 'shoe',
            edits: draft.categoryPayload(),
            controlledKeys: const {'favoriteBrands', 'preferredStyles'},
          ),
        ) &&
        await _syncBlock(
          blockId: draft.platformBlockId,
          blockType: 'platform_preferences',
          scope: 'global',
          sensitivity: 'low',
          payload: _mergedBlockPayload(
            blockType: 'platform_preferences',
            scope: 'global',
            edits: draft.platformPayload(),
            controlledKeys: const {'excludedPlatforms'},
          ),
        ) &&
        await _syncBlock(
          blockId: draft.shoppingBlockId,
          blockType: 'shopping_preferences',
          scope: 'global',
          sensitivity: 'low',
          payload: _mergedBlockPayload(
            blockType: 'shopping_preferences',
            scope: 'global',
            edits: draft.shoppingPayload(),
            controlledKeys: const {'decisionPriority'},
          ),
        ) &&
        await _syncBlock(
          blockId: draft.interactionBlockId,
          blockType: 'interaction_preferences',
          scope: 'global',
          sensitivity: 'low',
          payload: _mergedBlockPayload(
            blockType: 'interaction_preferences',
            scope: 'global',
            edits: draft.interactionPayload(),
            controlledKeys: const {'responseStyle'},
          ),
        );
    if (!mounted) return;
    if (!ok) {
      setState(() {
        _saving = false;
        _errorMessage = widget.submitter.lastFailureMessage;
      });
      return;
    }

    final normalizedShoeSize = _shoeSizeController.text.trim();
    UserPreferenceMemory.shoeSize =
        normalizedShoeSize.isEmpty ? null : normalizedShoeSize;

    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  Map<String, dynamic> _mergedBlockPayload({
    required String blockType,
    required String scope,
    required Map<String, dynamic> edits,
    required Set<String> controlledKeys,
  }) {
    final existing =
        _profile?.findBlock(blockType, scope)?.payload ?? <String, dynamic>{};
    final merged = Map<String, dynamic>.from(existing);
    for (final key in controlledKeys) {
      merged.remove(key);
    }
    merged.addAll(edits);
    merged.removeWhere((_, value) {
      if (value == null) return true;
      if (value is String) return value.trim().isEmpty;
      if (value is List) return value.isEmpty;
      return false;
    });
    return merged;
  }

  Future<bool> _syncBlock({
    required String? blockId,
    required String blockType,
    required String scope,
    required String sensitivity,
    required Map<String, dynamic> payload,
  }) async {
    if (payload.isEmpty) {
      return widget.submitter.deleteUserProfileBlock(blockId);
    }
    final block = await widget.submitter.saveUserProfileBlock(
      blockId: blockId,
      blockType: blockType,
      scope: scope,
      payload: payload,
      sensitivity: sensitivity,
    );
    return block != null;
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: DraggableScrollableSheet(
        initialChildSize: 0.88,
        minChildSize: 0.56,
        maxChildSize: 0.96,
        builder: (context, scrollController) {
          return ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(26)),
            child: Material(
              color: _SoftCommerceTheme.surface,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 10, 14, 8),
                    child: _buildHeader(context),
                  ),
                  Expanded(
                    child: _loading
                        ? const Center(
                            child: CircularProgressIndicator(
                              color: _SoftCommerceTheme.ink,
                            ),
                          )
                        : ListView(
                            controller: scrollController,
                            padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                            children: [
                              if (_errorMessage != null) ...[
                                UserProfileNotice(message: _errorMessage!),
                                const SizedBox(height: 14),
                              ],
                              UserProfileSection(
                                title: '基础信息',
                                children: [
                                  UserProfileTextField(
                                    controller: _nicknameController,
                                    label: '昵称',
                                    icon: Icons.badge_rounded,
                                  ),
                                  const SizedBox(height: 10),
                                  UserProfileTextField(
                                    controller: _cityController,
                                    label: '城市',
                                    icon: Icons.location_on_rounded,
                                  ),
                                  const SizedBox(height: 10),
                                  UserProfileTextField(
                                    controller: _shoeSizeController,
                                    label: '常穿鞋码',
                                    icon: Icons.straighten_rounded,
                                    keyboardType: TextInputType.number,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 16),
                              UserProfileSection(
                                title: '购物偏好',
                                children: [
                                  UserProfileTextField(
                                    controller: _favoriteBrandsController,
                                    label: '偏好品牌',
                                    icon: Icons.favorite_rounded,
                                  ),
                                  const SizedBox(height: 10),
                                  UserProfileTextField(
                                    controller: _preferredStylesController,
                                    label: '偏好风格',
                                    icon: Icons.style_rounded,
                                  ),
                                  const SizedBox(height: 10),
                                  UserProfileSelectField(
                                    label: '决策优先',
                                    value: _decisionPriority,
                                    options: _decisionPriorityOptions,
                                    onChanged: (value) {
                                      setState(() => _decisionPriority = value);
                                    },
                                  ),
                                  const SizedBox(height: 10),
                                  UserProfileSelectField(
                                    label: '回答风格',
                                    value: _responseStyle,
                                    options: _responseStyleOptions,
                                    onChanged: (value) {
                                      setState(() => _responseStyle = value);
                                    },
                                  ),
                                ],
                              ),
                              const SizedBox(height: 16),
                              UserProfileSection(
                                title: '排除平台',
                                children: [
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: [
                                      for (final option in _platformOptions)
                                        UserProfilePlatformChip(
                                          label: option.label,
                                          selected: _excludedPlatformIds
                                              .contains(option.id),
                                          onSelected: (selected) {
                                            setState(() {
                                              if (selected) {
                                                _excludedPlatformIds.add(
                                                  option.id,
                                                );
                                              } else {
                                                _excludedPlatformIds.remove(
                                                  option.id,
                                                );
                                              }
                                            });
                                          },
                                        ),
                                    ],
                                  ),
                                ],
                              ),
                              const SizedBox(height: 16),
                              UserProfileSection(
                                title: '已记录画像',
                                children: [
                                  if ((_profile?.blocks ?? const []).isEmpty)
                                    const UserProfileEmptyBlock()
                                  else
                                    for (final block in _profile!.blocks)
                                      UserProfileBlockPreview(block: block),
                                ],
                              ),
                            ],
                          ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 42,
          height: 4,
          decoration: BoxDecoration(
            color: const Color(0xFFD6D6D2),
            borderRadius: BorderRadius.circular(999),
          ),
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            const CircleAvatar(
              radius: 20,
              backgroundColor: _SoftCommerceTheme.ink,
              foregroundColor: _SoftCommerceTheme.surface,
              child: Icon(Icons.person_rounded, size: 20),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '用户画像',
                    style: TextStyle(
                      color: _SoftCommerceTheme.ink,
                      fontSize: 20,
                      height: 24 / 20,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  Text(
                    'User_8921',
                    style: TextStyle(
                      color: _SoftCommerceTheme.muted,
                      fontSize: 12,
                      height: 16 / 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: '关闭',
              onPressed: _saving ? null : () => Navigator.of(context).pop(),
              icon: const Icon(Icons.close_rounded),
            ),
            FilledButton.icon(
              onPressed: _loading || _saving || !_canSync ? null : _saveProfile,
              style: FilledButton.styleFrom(
                backgroundColor: _SoftCommerceTheme.ink,
                foregroundColor: _SoftCommerceTheme.surface,
                disabledBackgroundColor: const Color(0xFFE0E0DC),
                disabledForegroundColor: const Color(0xFF8A8A84),
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              icon: _saving
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: _SoftCommerceTheme.surface,
                      ),
                    )
                  : const Icon(Icons.check_rounded, size: 18),
              label: Text(_saving ? '保存中' : '保存'),
            ),
          ],
        ),
      ],
    );
  }
}

class _ProfilePlatformOption {
  const _ProfilePlatformOption(this.id, this.label);

  final String id;
  final String label;
}

class ProfileSelectOption {
  const ProfileSelectOption(this.value, this.label);

  final String value;
  final String label;
}

class UserProfileSection extends StatelessWidget {
  const UserProfileSection({
    required this.title,
    required this.children,
    super.key,
  });

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
      decoration: BoxDecoration(
        color: const Color(0xFFFAFAF8),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE8E8E4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: _SoftCommerceTheme.ink,
              fontSize: 14,
              height: 18 / 14,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }
}

class UserProfileTextField extends StatelessWidget {
  const UserProfileTextField({
    required this.controller,
    required this.label,
    required this.icon,
    this.keyboardType,
    super.key,
  });

  final TextEditingController controller;
  final String label;
  final IconData icon;
  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      textInputAction: TextInputAction.next,
      style: const TextStyle(
        color: _SoftCommerceTheme.ink,
        fontSize: 14,
        fontWeight: FontWeight.w700,
      ),
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon, size: 18),
        filled: true,
        fillColor: _SoftCommerceTheme.surface,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE0E0DC)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE0E0DC)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _SoftCommerceTheme.ink),
        ),
      ),
    );
  }
}

class UserProfileSelectField extends StatelessWidget {
  const UserProfileSelectField({
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
    super.key,
  });

  final String label;
  final String? value;
  final List<ProfileSelectOption> options;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        filled: true,
        fillColor: _SoftCommerceTheme.surface,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE0E0DC)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE0E0DC)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _SoftCommerceTheme.ink),
        ),
      ),
      items: [
        for (final option in options)
          DropdownMenuItem<String>(
            value: option.value,
            child: Text(option.label),
          ),
      ],
      onChanged: onChanged,
    );
  }
}

class UserProfilePlatformChip extends StatelessWidget {
  const UserProfilePlatformChip({
    required this.label,
    required this.selected,
    required this.onSelected,
    super.key,
  });

  final String label;
  final bool selected;
  final ValueChanged<bool> onSelected;

  @override
  Widget build(BuildContext context) {
    return FilterChip(
      selected: selected,
      showCheckmark: false,
      label: Text(label),
      avatar: selected
          ? const Icon(Icons.block_rounded, size: 16)
          : const Icon(Icons.add_rounded, size: 16),
      onSelected: onSelected,
      selectedColor: const Color(0xFF111111),
      backgroundColor: _SoftCommerceTheme.surface,
      labelStyle: TextStyle(
        color: selected ? _SoftCommerceTheme.surface : _SoftCommerceTheme.ink,
        fontSize: 12,
        fontWeight: FontWeight.w800,
      ),
      shape: StadiumBorder(
        side: BorderSide(
          color: selected ? _SoftCommerceTheme.ink : const Color(0xFFE0E0DC),
        ),
      ),
    );
  }
}

class UserProfileBlockPreview extends StatelessWidget {
  const UserProfileBlockPreview({required this.block, super.key});

  final UserProfileBlock block;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE5E5E1)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: _SoftCommerceTheme.recessed,
              shape: BoxShape.circle,
            ),
            child: Icon(
              _blockIcon(block.blockType),
              size: 15,
              color: _SoftCommerceTheme.ink,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _blockTitle(block.blockType),
                  style: const TextStyle(
                    color: _SoftCommerceTheme.ink,
                    fontSize: 13,
                    height: 17 / 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  _blockPayloadSummary(block.payload),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: _SoftCommerceTheme.muted,
                    fontSize: 12,
                    height: 17 / 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static IconData _blockIcon(String blockType) {
    return switch (blockType) {
      'size_profile' => Icons.straighten_rounded,
      'platform_preferences' => Icons.block_rounded,
      'category_preferences' => Icons.style_rounded,
      'shopping_preferences' => Icons.shopping_bag_rounded,
      'interaction_preferences' => Icons.chat_bubble_rounded,
      _ => Icons.person_rounded,
    };
  }

  static String _blockTitle(String blockType) {
    return switch (blockType) {
      'identity_basic' => '基础信息',
      'size_profile' => '尺码信息',
      'category_preferences' => '鞋类偏好',
      'platform_preferences' => '平台偏好',
      'shopping_preferences' => '购物决策',
      'interaction_preferences' => '沟通偏好',
      _ => blockType,
    };
  }

  static String _blockPayloadSummary(Map<String, dynamic> payload) {
    if (payload.isEmpty) return '空';
    return payload.entries.map((entry) {
      final value = entry.value;
      if (value is List) return '${_fieldLabel(entry.key)}: ${value.join('、')}';
      return '${_fieldLabel(entry.key)}: $value';
    }).join(' · ');
  }

  static String _fieldLabel(String key) {
    return switch (key) {
      'nickname' => '昵称',
      'city' => '城市',
      'shoeSize' => '鞋码',
      'favoriteBrands' => '品牌',
      'preferredStyles' => '风格',
      'excludedPlatforms' => '排除平台',
      'decisionPriority' => '决策优先',
      'responseStyle' => '回答风格',
      _ => key,
    };
  }
}

class UserProfileEmptyBlock extends StatelessWidget {
  const UserProfileEmptyBlock({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE5E5E1)),
      ),
      child: const Text(
        '暂无已确认画像',
        style: TextStyle(
          color: _SoftCommerceTheme.muted,
          fontSize: 13,
          height: 18 / 13,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class UserProfileNotice extends StatelessWidget {
  const UserProfileNotice({required this.message, super.key});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 11, 12, 11),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF5DC),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFF0D995)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.info_rounded,
            color: Color(0xFF80620D),
            size: 18,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: Color(0xFF6B530E),
                fontSize: 12,
                height: 16 / 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

enum CandidateSortMode {
  match('相似度', Icons.verified_rounded),
  price('低价', Icons.currency_yen_rounded),
  priceHigh('高价', Icons.north_rounded),
  rating('好评', Icons.star_rounded),
  delivery('送达', Icons.local_shipping_rounded);

  const CandidateSortMode(this.label, this.icon);

  final String label;
  final IconData icon;
}

int compareCandidatesByMatch(DemoCandidate a, DemoCandidate b) {
  final scoreCompare = b.matchScore.compareTo(a.matchScore);
  if (scoreCompare != 0) return scoreCompare;
  return a.candidateItemId.compareTo(b.candidateItemId);
}

String platformDisplayName(String platform) {
  final normalized = platform.trim().toLowerCase();
  if (normalized.contains('taobao')) return '淘宝';
  if (normalized.contains('tmall')) return '天猫';
  if (normalized.contains('dewu')) return '得物';
  if (normalized.contains('jd')) return '京东';
  if (normalized.contains('vipshop')) return '唯品会';
  if (normalized.contains('suning')) return '苏宁';
  if (normalized.contains('pdd')) return '拼多多';
  if (normalized.contains('douyin')) return '抖音';
  return platform.isEmpty ? '平台' : platform;
}

Color platformAccentColor(String platform) {
  return switch (platformDisplayName(platform)) {
    '淘宝' => const Color(0xFFFFB35C),
    '天猫' => const Color(0xFFFF6E8A),
    '得物' => const Color(0xFF8BFFD9),
    '京东' => const Color(0xFFFFD37B),
    '唯品会' => const Color(0xFFFF8BC4),
    '苏宁' => const Color(0xFFFFD46A),
    '拼多多' => const Color(0xFFFF8FB8),
    '抖音' => const Color(0xFF8EA7FF),
    _ => const Color(0xFFE9D4FF),
  };
}

String platformLogoText(String platform) {
  return switch (platformDisplayName(platform)) {
    '淘宝' => '淘',
    '天猫' => '猫',
    '得物' => '得',
    '京东' => '京',
    '唯品会' => '唯',
    '苏宁' => '苏',
    '拼多多' => '拼',
    '抖音' => '抖',
    _ => '商',
  };
}

Color platformLogoBackground(String platform) {
  return switch (platformDisplayName(platform)) {
    '淘宝' => const Color(0xFFFF6A00),
    '天猫' => const Color(0xFFE60012),
    '得物' => const Color(0xFF111827),
    '京东' => const Color(0xFFE1251B),
    '唯品会' => const Color(0xFFE4007F),
    '苏宁' => const Color(0xFFF9A900),
    '拼多多' => const Color(0xFFE02E24),
    '抖音' => const Color(0xFF101014),
    _ => const Color(0xFF5B5AF7),
  };
}

void main() {
  runApp(const ShoppingAssistantApp());
}

class ShoppingAssistantApp extends StatelessWidget {
  const ShoppingAssistantApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: '智能比价助手',
      theme: ThemeData(
        brightness: Brightness.light,
        fontFamily: 'Plus Jakarta Sans',
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF111111),
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: _SoftCommerceTheme.canvas,
        textTheme: const TextTheme(
          headlineLarge: TextStyle(
            fontSize: 32,
            height: 1.12,
            fontWeight: FontWeight.w900,
            letterSpacing: 0,
            color: _SoftCommerceTheme.ink,
          ),
          titleLarge: TextStyle(
            fontSize: 22,
            height: 1.22,
            fontWeight: FontWeight.w900,
            letterSpacing: 0,
            color: _SoftCommerceTheme.ink,
          ),
          bodyMedium: TextStyle(
            fontSize: 15,
            height: 1.45,
            fontWeight: FontWeight.w500,
            letterSpacing: 0,
            color: _SoftCommerceTheme.ink,
          ),
        ),
      ),
      home: const SoftHomePage(),
    );
  }
}

class _SoftCommerceTheme {
  const _SoftCommerceTheme._();

  static const canvas = Color(0xFFF2F2F2);
  static const surface = Color(0xFFFFFFFF);
  static const recessed = Color(0xFFEDEDED);
  static const ink = Color(0xFF111111);
  static const muted = Color(0xFF7A7A7A);
  static const faint = Color(0xFFA8A8A8);
  static const border = Color(0xFFE6E6E6);
  static const stock = Color(0xFF2E8B57);
  static const warning = Color(0xFFB88900);
  static const danger = Color(0xFFD65A5A);

  static BoxShadow get shadow => BoxShadow(
        color: Colors.black.withValues(alpha: 0.08),
        blurRadius: 36,
        offset: const Offset(0, 16),
      );

  static BoxShadow get tightShadow => BoxShadow(
        color: Colors.black.withValues(alpha: 0.10),
        blurRadius: 20,
        offset: const Offset(0, 10),
      );

  static BoxShadow get buttonShadow => BoxShadow(
        color: Colors.black.withValues(alpha: 0.18),
        blurRadius: 24,
        offset: const Offset(0, 12),
      );
}

enum SoftMessageRole { user, assistant, system }

class SoftConversationMessage {
  const SoftConversationMessage({
    required this.role,
    required this.text,
    required this.createdAt,
    this.resultCandidates = const <DemoCandidate>[],
    this.resultSessionId,
  });

  final SoftMessageRole role;
  final String text;
  final DateTime createdAt;
  final List<DemoCandidate> resultCandidates;
  final String? resultSessionId;

  Map<String, dynamic> toJson() => {
        'role': role.name,
        'text': text,
        'createdAt': createdAt.toIso8601String(),
        if (resultCandidates.isNotEmpty)
          'resultCandidates':
              resultCandidates.map((candidate) => candidate.toJson()).toList(),
        if (resultSessionId != null) 'resultSessionId': resultSessionId,
      };

  factory SoftConversationMessage.fromJson(Map<String, dynamic> json) {
    return SoftConversationMessage(
      role: SoftMessageRole.values.firstWhere(
        (item) => item.name == json['role']?.toString(),
        orElse: () => SoftMessageRole.assistant,
      ),
      text: json['text']?.toString() ?? '',
      createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '') ??
          DateTime.now(),
      resultCandidates: _jsonList(json['resultCandidates'])
          .map((item) => DemoCandidate.fromJson(_softMap(item)))
          .toList(growable: false),
      resultSessionId: json['resultSessionId']?.toString(),
    );
  }
}

class SoftConversationThread {
  const SoftConversationThread({
    required this.id,
    required this.title,
    required this.messages,
    required this.candidates,
    required this.updatedAt,
    this.remoteSessionId,
  });

  final String id;
  final String title;
  final List<SoftConversationMessage> messages;
  final List<DemoCandidate> candidates;
  final DateTime updatedAt;
  final String? remoteSessionId;

  int get candidateCount => candidates.length;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'messages': messages.map((message) => message.toJson()).toList(),
        'candidates':
            candidates.map((candidate) => candidate.toJson()).toList(),
        'updatedAt': updatedAt.toIso8601String(),
        if (remoteSessionId != null) 'remoteSessionId': remoteSessionId,
      };

  factory SoftConversationThread.fromJson(Map<String, dynamic> json) {
    final messages = _jsonList(json['messages'])
        .map((item) => SoftConversationMessage.fromJson(_softMap(item)))
        .where((message) => message.text.trim().isNotEmpty)
        .toList(growable: false);
    return SoftConversationThread(
      id: json['id']?.toString() ??
          'thread_${DateTime.now().microsecondsSinceEpoch}',
      title: json['title']?.toString() ?? '新对话',
      messages: messages,
      candidates: _jsonList(json['candidates'])
          .map((item) => DemoCandidate.fromJson(_softMap(item)))
          .toList(growable: false),
      updatedAt: DateTime.tryParse(json['updatedAt']?.toString() ?? '') ??
          DateTime.now(),
      remoteSessionId: json['remoteSessionId']?.toString(),
    );
  }
}

class SoftSuggestionAction {
  const SoftSuggestionAction({
    required this.title,
    this.cardId = '',
    this.prompt = '',
    this.reason,
    this.subtitle,
    this.cardType = 'filter',
    this.actionType = 'submit_turn',
    this.candidateItemId,
    this.field,
    this.filterPatch = const <String, dynamic>{},
  });

  final String title;
  final String cardId;
  final String prompt;
  final String? reason;
  final String? subtitle;
  final String cardType;
  final String actionType;
  final String? candidateItemId;
  final String? field;
  final Map<String, dynamic> filterPatch;

  bool get isSubmitTurn => actionType == 'submit_turn' && prompt.isNotEmpty;
}

class SoftBackendSuggestionDraft {
  const SoftBackendSuggestionDraft({
    required this.conclusion,
    required this.actions,
  });

  final String conclusion;
  final List<SoftSuggestionAction> actions;

  factory SoftBackendSuggestionDraft.fromResponse(
    SuggestionListResponse response,
  ) {
    final actions = <SoftSuggestionAction>[];
    for (final card in response.cards) {
      final title = card.title.trim();
      if (title.isEmpty) continue;
      actions.add(
        SoftSuggestionAction(
          title: title,
          cardId: card.cardId,
          prompt: card.action.message?.trim() ?? '',
          reason: card.reason.trim().isEmpty ? null : card.reason,
          subtitle: card.subtitle,
          cardType: card.type,
          actionType: card.action.type,
          candidateItemId: card.action.candidateItemId,
          field: card.action.field,
          filterPatch: card.action.filterPatch,
        ),
      );
    }
    if (actions.isEmpty) {
      for (final option in response.nextRefineOptions) {
        final title = option.title.trim();
        final message = option.message.trim();
        if (title.isEmpty) continue;
        actions.add(
          SoftSuggestionAction(
            title: title,
            prompt: message.isEmpty ? title : message,
          ),
        );
      }
    }
    return SoftBackendSuggestionDraft(
      conclusion: response.recommendationConclusion,
      actions: actions.take(6).toList(growable: false),
    );
  }
}

enum EmptyHomeGuideActionType { camera, prompt }

class EmptyHomeGuideRecommendation {
  const EmptyHomeGuideRecommendation({
    required this.label,
    required this.icon,
    required this.actionType,
    this.prompt = '',
  });

  final String label;
  final IconData icon;
  final EmptyHomeGuideActionType actionType;
  final String prompt;

  bool get opensCamera => actionType == EmptyHomeGuideActionType.camera;

  static List<EmptyHomeGuideRecommendation> build({
    required UserProfileResponse? profile,
    required List<SoftConversationThread> threads,
  }) {
    final recommendations = <EmptyHomeGuideRecommendation>[];
    final seen = <String>{};

    void add(EmptyHomeGuideRecommendation item) {
      final key = item.label.trim();
      if (key.isEmpty || !seen.add(key)) return;
      recommendations.add(item);
    }

    final gender = _shoppingGenderLabel(profile, threads);
    final platform = _firstPlatform(profile);
    final platformLabel = _platformLabel(platform);
    final brand = _firstProfileListValue(
      profile,
      blockType: 'category_preferences',
      scope: 'shoe',
      key: 'favoriteBrands',
    );
    final style = _firstProfileListValue(
      profile,
      blockType: 'category_preferences',
      scope: 'shoe',
      key: 'preferredStyles',
    );

    add(
      const EmptyHomeGuideRecommendation(
        label: '拍鞋找同款',
        icon: Icons.camera_alt_outlined,
        actionType: EmptyHomeGuideActionType.camera,
      ),
    );

    for (final thread in threads.take(6)) {
      final prompt = _firstUserPrompt(thread);
      if (prompt == null) continue;
      if (prompt.contains('通勤')) {
        add(
          EmptyHomeGuideRecommendation(
            label: '$gender通勤鞋',
            icon: Icons.work_outline_rounded,
            actionType: EmptyHomeGuideActionType.prompt,
            prompt: '有什么适合$gender通勤穿的鞋？',
          ),
        );
      }
      if (prompt.contains('跑鞋') || prompt.contains('跑步')) {
        add(
          const EmptyHomeGuideRecommendation(
            label: '500以内跑鞋',
            icon: Icons.directions_run_rounded,
            actionType: EmptyHomeGuideActionType.prompt,
            prompt: '帮我找500元以内的跑鞋',
          ),
        );
      }
      if (prompt.contains('得物')) {
        add(
          const EmptyHomeGuideRecommendation(
            label: '去得物随便看看',
            icon: Icons.shopping_bag_outlined,
            actionType: EmptyHomeGuideActionType.prompt,
            prompt: '搜索得物的商品',
          ),
        );
      }
    }

    if (brand != null) {
      add(
        EmptyHomeGuideRecommendation(
          label: '$brand 鞋推荐',
          icon: Icons.verified_outlined,
          actionType: EmptyHomeGuideActionType.prompt,
          prompt: '帮我找适合我的 $brand 鞋',
        ),
      );
    }

    if (style != null) {
      final styleLabel = _shoeStyleLabel(style);
      add(
        EmptyHomeGuideRecommendation(
          label: '$styleLabel鞋',
          icon: Icons.style_outlined,
          actionType: EmptyHomeGuideActionType.prompt,
          prompt: '帮我找$styleLabel风格的鞋',
        ),
      );
    }

    add(
      EmptyHomeGuideRecommendation(
        label: '$gender通勤鞋',
        icon: Icons.work_outline_rounded,
        actionType: EmptyHomeGuideActionType.prompt,
        prompt: '有什么适合$gender通勤穿的鞋？',
      ),
    );
    add(
      const EmptyHomeGuideRecommendation(
        label: '500以内跑鞋',
        icon: Icons.directions_run_rounded,
        actionType: EmptyHomeGuideActionType.prompt,
        prompt: '帮我找500元以内的跑鞋',
      ),
    );
    add(
      EmptyHomeGuideRecommendation(
        label: platform == 'dewu' ? '去得物随便看看' : '去$platformLabel看看',
        icon: Icons.shopping_bag_outlined,
        actionType: EmptyHomeGuideActionType.prompt,
        prompt: platform == 'dewu' ? '搜索得物的商品' : '搜索$platformLabel的商品',
      ),
    );

    return recommendations.take(4).toList(growable: false);
  }

  static String examplePrompt({
    required UserProfileResponse? profile,
    required List<SoftConversationThread> threads,
  }) {
    final gender = _shoppingGenderLabel(profile, threads);
    return '有什么适合$gender通勤穿的鞋？';
  }

  static String? _firstUserPrompt(SoftConversationThread thread) {
    for (final message in thread.messages) {
      if (message.role == SoftMessageRole.user &&
          message.text.trim().isNotEmpty) {
        return message.text.trim();
      }
    }
    return null;
  }

  static String _shoppingGenderLabel(
    UserProfileResponse? profile,
    List<SoftConversationThread> threads,
  ) {
    final profileGender =
        _profileString(profile, 'identity_basic', 'global', 'shoppingGender') ??
            _profileString(profile, 'identity_basic', 'global', 'gender') ??
            _profileString(profile, 'shopping_preferences', 'global', 'gender');
    final normalized = profileGender?.toLowerCase();
    if (normalized == 'female' || normalized == 'woman' || normalized == '女') {
      return '女生';
    }
    if (normalized == 'male' || normalized == 'man' || normalized == '男') {
      return '男生';
    }
    for (final thread in threads.take(6)) {
      final prompt = _firstUserPrompt(thread) ?? '';
      if (prompt.contains('女生') || prompt.contains('女款')) return '女生';
      if (prompt.contains('男生') || prompt.contains('男款')) return '男生';
    }
    return '男生';
  }

  static String? _firstProfileListValue(
    UserProfileResponse? profile, {
    required String blockType,
    required String scope,
    required String key,
  }) {
    final values = _profileListValues(
      profile,
      blockType: blockType,
      scope: scope,
      key: key,
    );
    return values.isEmpty ? null : values.first;
  }

  static List<String> _profileListValues(
    UserProfileResponse? profile, {
    required String blockType,
    required String scope,
    required String key,
  }) {
    final value = profile?.findBlock(blockType, scope)?.payload[key];
    if (value is List) {
      return [
        for (final item in value)
          if (item.toString().trim().isNotEmpty) item.toString().trim(),
      ];
    }
    final text = value?.toString().trim();
    if (text == null || text.isEmpty) return const [];
    return text
        .split(RegExp(r'[,，、\s]+'))
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty)
        .toList(growable: false);
  }

  static String? _profileString(
    UserProfileResponse? profile,
    String blockType,
    String scope,
    String key,
  ) {
    final text = profile?.findBlock(blockType, scope)?.payload[key]?.toString();
    final normalized = text?.trim();
    return normalized == null || normalized.isEmpty ? null : normalized;
  }

  static String _firstPlatform(UserProfileResponse? profile) {
    final excluded = _profileListValues(
      profile,
      blockType: 'platform_preferences',
      scope: 'global',
      key: 'excludedPlatforms',
    ).map((item) => item.toLowerCase()).toSet();
    final preferred = _profileListValues(
      profile,
      blockType: 'platform_preferences',
      scope: 'global',
      key: 'preferredPlatforms',
    ).map((item) => item.toLowerCase());
    for (final platform in preferred) {
      if (!excluded.contains(platform)) return platform;
    }
    for (final platform in const ['dewu', 'jd', 'taobao', 'tmall']) {
      if (!excluded.contains(platform)) return platform;
    }
    return 'dewu';
  }

  static String _platformLabel(String platform) {
    return switch (platform.toLowerCase()) {
      'dewu' => '得物',
      'jd' || 'jingdong' => '京东',
      'taobao' => '淘宝',
      'tmall' => '天猫',
      'pdd' || 'pinduoduo' => '拼多多',
      'douyin' => '抖音',
      _ => platform,
    };
  }

  static String _shoeStyleLabel(String style) {
    return switch (style.toLowerCase()) {
      'running' || 'run' => '跑步',
      'basketball' => '篮球',
      'skate' => '板鞋',
      'casual' => '休闲',
      'training' => '训练',
      'outdoor' => '户外',
      _ => style,
    };
  }
}

class SoftHomePage extends StatefulWidget {
  const SoftHomePage({super.key});

  @override
  State<SoftHomePage> createState() => _SoftHomePageState();
}

class _SoftHomePageState extends State<SoftHomePage> {
  final _picker = ImagePicker();
  final _promptController = TextEditingController();
  final _promptFocusNode = FocusNode();
  final _conversationStore = const LocalJsonStore(
    'soft_home_conversations_v1.json',
  );
  late final LatestScreenshotDetector _latestScreenshotDetector;
  Future<void> _lastConversationPersist = Future<void>.value();
  bool _isPicking = false;
  bool _isListening = false;
  bool _showSourceMenu = false;
  bool _homeHasConversation = false;
  bool _homeWaitingForRemote = false;
  final String _cityLabel = '定位';
  String _lastHomePrompt = '';
  String? _homeRemoteSessionId;
  String? _activeThreadId;
  LatestScreenshot? _suggestedScreenshot;
  UserProfileResponse? _homeUserProfile;
  List<DemoCandidate> _homeCandidates = const [];
  final List<SoftConversationMessage> _homeMessages = [];
  final List<SoftConversationThread> _conversationThreads = [];

  bool get _shouldShowEmptyHomeGuide =>
      !_homeHasConversation &&
      !_homeWaitingForRemote &&
      _homeMessages.isEmpty &&
      _homeCandidates.isEmpty;

  List<EmptyHomeGuideRecommendation> get _homeGuideRecommendations =>
      EmptyHomeGuideRecommendation.build(
        profile: _homeUserProfile,
        threads: _conversationThreads,
      );

  String get _homeGuideExamplePrompt =>
      EmptyHomeGuideRecommendation.examplePrompt(
        profile: _homeUserProfile,
        threads: _conversationThreads,
      );

  @override
  void initState() {
    super.initState();
    _latestScreenshotDetector = LatestScreenshotDetector(
      onDetected: _handleLatestScreenshotDetected,
    );
    unawaited(_restoreConversationState());
    unawaited(_latestScreenshotDetector.start());
    unawaited(_loadHomeGuideProfile());
  }

  @override
  void dispose() {
    _latestScreenshotDetector.dispose();
    _promptController.dispose();
    _promptFocusNode.dispose();
    super.dispose();
  }

  void _saveCurrentThread() {
    if (_homeMessages.isEmpty) return;
    final id =
        _activeThreadId ?? 'thread_${DateTime.now().microsecondsSinceEpoch}';
    _activeThreadId = id;
    final thread = SoftConversationThread(
      id: id,
      title: _threadTitleFromMessages(_homeMessages),
      messages: List.unmodifiable(_homeMessages),
      candidates: List.unmodifiable(_homeCandidates),
      remoteSessionId: _homeRemoteSessionId,
      updatedAt: DateTime.now(),
    );
    _conversationThreads.removeWhere((item) => item.id == id);
    _conversationThreads.insert(0, thread);
    if (_conversationThreads.length > 12) {
      _conversationThreads.removeRange(12, _conversationThreads.length);
    }
    _queuePersistConversationState();
  }

  String? get _activeCartSessionId => _homeRemoteSessionId;

  Future<void> _restoreConversationState() async {
    final stored = await _conversationStore.read();
    final threads = _jsonList(stored['threads'])
        .map((item) => SoftConversationThread.fromJson(_softMap(item)))
        .where((thread) => thread.messages.isNotEmpty)
        .toList(growable: false);
    if (!mounted || threads.isEmpty) return;

    final activeThreadId = stored['activeThreadId']?.toString();
    SoftConversationThread? activeThread;
    if (activeThreadId != null && activeThreadId.isNotEmpty) {
      for (final thread in threads) {
        if (thread.id == activeThreadId) {
          activeThread = thread;
          break;
        }
      }
    }

    setState(() {
      _conversationThreads
        ..clear()
        ..addAll(threads.take(12));
      if (activeThread != null) {
        _activeThreadId = activeThread.id;
        _homeRemoteSessionId = activeThread.remoteSessionId;
        _homeMessages
          ..clear()
          ..addAll(activeThread.messages);
        _homeCandidates = activeThread.candidates;
        _lastHomePrompt = _threadTitleFromMessages(activeThread.messages);
        _homeHasConversation = activeThread.messages.isNotEmpty;
        _homeWaitingForRemote = false;
      }
    });
    unawaited(sessionShoppingCartStore.refreshSession(_homeRemoteSessionId));
  }

  Future<void> _loadHomeGuideProfile() async {
    if (!requirementSubmitter.canSyncUserProfile) return;
    final profile = await requirementSubmitter.fetchUserProfile();
    if (!mounted || profile == null) return;
    setState(() => _homeUserProfile = profile);
  }

  void _queuePersistConversationState() {
    _lastConversationPersist =
        _lastConversationPersist.catchError((Object error) {
      debugPrint('conversation persist queue recovered: $error');
    }).then((_) => _persistConversationState());
  }

  Future<void> _persistConversationState() async {
    try {
      await _conversationStore.write({
        'version': 1,
        'activeThreadId': _activeThreadId,
        'threads': _conversationThreads
            .take(12)
            .map((thread) => thread.toJson())
            .toList(),
        'updatedAt': DateTime.now().toIso8601String(),
      });
    } on FileSystemException catch (error) {
      debugPrint('conversation persistence failed: $error');
    }
  }

  void _openThread(SoftConversationThread thread) {
    Navigator.of(context).maybePop();
    setState(() {
      _activeThreadId = thread.id;
      _homeRemoteSessionId = thread.remoteSessionId;
      _homeMessages
        ..clear()
        ..addAll(thread.messages);
      _homeCandidates = thread.candidates;
      _lastHomePrompt = _threadTitleFromMessages(thread.messages);
      _homeHasConversation = true;
      _homeWaitingForRemote = false;
      _showSourceMenu = false;
      _promptController.clear();
    });
    unawaited(sessionShoppingCartStore.refreshSession(_homeRemoteSessionId));
    _queuePersistConversationState();
  }

  String _threadTitleFromMessages(List<SoftConversationMessage> messages) {
    for (final message in messages) {
      if (message.role == SoftMessageRole.user &&
          message.text.trim().isNotEmpty) {
        return _compactThreadTitle(message.text);
      }
    }
    return '新对话';
  }

  String _compactThreadTitle(String text) {
    final normalized = text.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (normalized.length <= 18) return normalized;
    return '${normalized.substring(0, 18)}...';
  }

  Future<void> _startConversationFromPrompt() async {
    if (_homeWaitingForRemote) {
      _showMessage('正在处理上一条消息，请稍等。');
      return;
    }
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty) {
      _showMessage('先输入你想找的商品、预算或筛选条件。');
      _promptFocusNode.requestFocus();
      return;
    }

    FocusScope.of(context).unfocus();
    final canContinueRemoteSession = _homeHasConversation &&
        _homeRemoteSessionId != null &&
        !_homeRemoteSessionId!.startsWith('LOCAL-');
    final pendingRemoteSession = canContinueRemoteSession
        ? null
        : requirementSubmitter.createSessionFromText(prompt);
    final pendingRemoteTurn = canContinueRemoteSession
        ? requirementSubmitter.submitSessionTurnPage(
            sessionId: _homeRemoteSessionId!,
            text: prompt,
          )
        : null;
    setState(() {
      _showSourceMenu = false;
      _homeHasConversation = true;
      _homeWaitingForRemote = true;
      _lastHomePrompt = prompt;
      _promptController.clear();
      _homeMessages.add(
        SoftConversationMessage(
          role: SoftMessageRole.user,
          text: prompt,
          createdAt: DateTime.now(),
        ),
      );
      if (!canContinueRemoteSession) {
        _homeMessages.add(
          SoftConversationMessage(
            role: SoftMessageRole.assistant,
            text: '我先理解你的需求，正在准备回复。',
            createdAt: DateTime.now(),
          ),
        );
      }
      _saveCurrentThread();
    });
    if (pendingRemoteTurn != null) {
      unawaited(_applyHomeRemoteTurn(pendingRemoteTurn));
    } else {
      unawaited(_applyHomeRemoteCandidates(pendingRemoteSession!));
    }
  }

  Future<void> _applyHomeRemoteCandidates(
    Future<RemoteSessionDraft?> pendingRemote,
  ) async {
    final remote = await pendingRemote;
    final remoteCandidates = remote?.candidates ?? const <DemoCandidate>[];
    if (!mounted) return;
    final shouldOpenResults = remote != null &&
        remote.stateChangingTurn &&
        remoteCandidates.isNotEmpty;
    setState(() {
      _homeWaitingForRemote = false;
      if (remote != null) {
        _homeRemoteSessionId = remote.sessionId;
        unawaited(sessionShoppingCartStore.refreshSession(remote.sessionId));
      }
      final assistantMessage = remote?.assistantMessage?.trim();
      if (assistantMessage != null && assistantMessage.isNotEmpty) {
        _replaceOrAppendLastAssistantMessage(
          assistantMessage,
          resultCandidates: remoteCandidates,
          resultSessionId: remote?.sessionId,
        );
      } else if (remote != null &&
          remote.stateChangingTurn &&
          remoteCandidates.isNotEmpty) {
        _replaceOrAppendLastAssistantMessage(
          '已为您找到 ${remoteCandidates.length} 个候选商品。',
          resultCandidates: remoteCandidates,
          resultSessionId: remote.sessionId,
        );
      } else if (remote != null && remote.stateChangingTurn) {
        _replaceOrAppendLastAssistantMessage(
          '暂时没有找到符合条件的商品，可以放宽品牌、预算或库存条件再试。',
        );
      } else if (remote == null) {
        _replaceOrAppendLastAssistantMessage(
          requirementSubmitter.lastFailureMessage,
        );
      }
      if (remote != null &&
          remote.stateChangingTurn &&
          remoteCandidates.isNotEmpty) {
        _homeCandidates = remoteCandidates;
      }
      _saveCurrentThread();
    });
    if (shouldOpenResults && mounted) {
      await _openHomeResults(
        remoteCandidates,
        remote.sessionId,
        playInitialRevealAnimation: true,
      );
    }
  }

  Future<void> _applyHomeRemoteTurn(
    Future<RemoteCandidatePage?> pendingRemote,
  ) async {
    final remote = await pendingRemote;
    final remoteCandidates = remote?.candidates ?? const <DemoCandidate>[];
    if (!mounted) return;
    final shouldOpenResults = remote != null &&
        remote.stateChangingTurn &&
        remoteCandidates.isNotEmpty;
    setState(() {
      _homeWaitingForRemote = false;
      final assistantMessage = remote?.assistantMessage?.trim();
      final noUpdatedCandidates = remote != null &&
          remote.stateChangingTurn &&
          remoteCandidates.isEmpty;
      if (assistantMessage != null && assistantMessage.isNotEmpty) {
        _homeMessages.add(
          SoftConversationMessage(
            role: SoftMessageRole.assistant,
            text: assistantMessage,
            createdAt: DateTime.now(),
            resultCandidates: noUpdatedCandidates
                ? const <DemoCandidate>[]
                : remoteCandidates,
            resultSessionId: _homeRemoteSessionId,
          ),
        );
      } else if (remote != null &&
          remote.stateChangingTurn &&
          remoteCandidates.isNotEmpty) {
        _homeMessages.add(
          SoftConversationMessage(
            role: SoftMessageRole.assistant,
            text: '已按您的新要求更新为 ${remoteCandidates.length} 个候选商品。',
            createdAt: DateTime.now(),
            resultCandidates: remoteCandidates,
            resultSessionId: _homeRemoteSessionId,
          ),
        );
      } else if (noUpdatedCandidates) {
        _homeMessages.add(
          SoftConversationMessage(
            role: SoftMessageRole.assistant,
            text: '没有找到符合这次条件的商品，我先保留当前候选结果。',
            createdAt: DateTime.now(),
          ),
        );
      } else if (remote == null) {
        _homeMessages.add(
          SoftConversationMessage(
            role: SoftMessageRole.assistant,
            text: requirementSubmitter.lastFailureMessage,
            createdAt: DateTime.now(),
          ),
        );
      }
      if (remote != null &&
          remote.stateChangingTurn &&
          remoteCandidates.isNotEmpty) {
        _homeCandidates = remoteCandidates;
      }
      _saveCurrentThread();
    });
    if (shouldOpenResults && mounted) {
      await _openHomeResults(
        remoteCandidates,
        _homeRemoteSessionId,
        playInitialRevealAnimation: true,
      );
    }
  }

  void _replaceOrAppendLastAssistantMessage(
    String text, {
    List<DemoCandidate> resultCandidates = const <DemoCandidate>[],
    String? resultSessionId,
  }) {
    if (_homeMessages.isNotEmpty &&
        _homeMessages.last.role == SoftMessageRole.assistant) {
      _homeMessages[_homeMessages.length - 1] = SoftConversationMessage(
        role: SoftMessageRole.assistant,
        text: text,
        createdAt: DateTime.now(),
        resultCandidates: resultCandidates,
        resultSessionId: resultSessionId,
      );
      return;
    }
    _homeMessages.add(
      SoftConversationMessage(
        role: SoftMessageRole.assistant,
        text: text,
        createdAt: DateTime.now(),
        resultCandidates: resultCandidates,
        resultSessionId: resultSessionId,
      ),
    );
  }

  Future<void> _openHomeResults(
    List<DemoCandidate>? candidates,
    String? sessionId, {
    bool playInitialRevealAnimation = false,
  }) async {
    final targetCandidates =
        candidates?.isNotEmpty == true ? candidates! : _homeCandidates;
    final targetSessionId = sessionId ?? _homeRemoteSessionId;
    await _openConversation(
      FigmaResultsPage(
        initialPrompt: _lastHomePrompt,
        remoteSessionId: targetSessionId,
        remoteCandidates: targetCandidates,
        playInitialRevealAnimation: playInitialRevealAnimation,
        onConversationUpdate: _applyResultConversationUpdate,
      ),
    );
  }

  void _applyResultConversationUpdate(FigmaResultConversationUpdate update) {
    final userText = update.userMessage?.trim();
    final assistantText = update.assistantMessage?.trim();
    setState(() {
      _homeHasConversation = true;
      _homeWaitingForRemote = false;
      _showSourceMenu = false;
      _lastHomePrompt =
          userText?.isNotEmpty == true ? userText! : _lastHomePrompt;
      if (update.sessionId != null && update.sessionId!.isNotEmpty) {
        _homeRemoteSessionId = update.sessionId;
        unawaited(sessionShoppingCartStore.refreshSession(update.sessionId));
      }
      if (userText != null && userText.isNotEmpty) {
        _homeMessages.add(
          SoftConversationMessage(
            role: SoftMessageRole.user,
            text: userText,
            createdAt: DateTime.now(),
          ),
        );
      }
      if (assistantText != null && assistantText.isNotEmpty) {
        _replaceOrAppendLastAssistantMessage(
          assistantText,
          resultCandidates:
              update.stateChangingTurn ? update.candidates : const [],
          resultSessionId: update.sessionId ?? _homeRemoteSessionId,
        );
      }
      if (update.stateChangingTurn && update.candidates.isNotEmpty) {
        _homeCandidates = update.candidates;
      }
      _saveCurrentThread();
    });
  }

  Future<void> _openCurrentCart() async {
    final sessionId = _activeCartSessionId;
    if (sessionId == null || sessionId.isEmpty) {
      _showMessage('当前对话还没有可查看的购物车。');
      return;
    }
    await sessionShoppingCartStore.refreshSession(sessionId);
    if (!mounted) return;
    await _openConversation(
      SessionShoppingCartPage(
        sessionId: sessionId,
        title: _lastHomePrompt.isEmpty ? '当前对话购物车' : _lastHomePrompt,
      ),
    );
  }

  Future<void> _startVoiceConversation() async {
    final text = await _listenForVoiceText();
    if (!mounted || text == null) return;
    _promptController.text = text;
    _promptController.selection = TextSelection.collapsed(offset: text.length);
    await _startConversationFromPrompt();
  }

  void _handleHomeGuideRecommendation(EmptyHomeGuideRecommendation item) {
    if (item.opensCamera) {
      unawaited(_chooseImageSource());
      return;
    }
    final prompt = item.prompt.trim();
    if (prompt.isEmpty || _homeWaitingForRemote) return;
    _promptController.text = prompt;
    _promptController.selection = TextSelection.collapsed(
      offset: prompt.length,
    );
    unawaited(_startConversationFromPrompt());
  }

  Future<String?> _listenForVoiceText() async {
    if (_isListening) return null;
    setState(() => _isListening = true);
    try {
      await voiceChannel.invokeMethod<bool>('ensurePermission');
      final spokenText = await voiceChannel.invokeMethod<String>('listen');
      if (!mounted) return null;
      final text = spokenText?.trim();
      if (text == null || text.isEmpty) {
        _showMessage('没有听到内容，可以直接输入。');
        return null;
      }
      return text;
    } on PlatformException catch (error) {
      if (mounted) _showMessage(error.message ?? '暂时无法使用语音输入。');
      return null;
    } on MissingPluginException {
      if (mounted) _showMessage('当前平台暂不支持语音输入，可以先手动输入。');
      return null;
    } finally {
      if (mounted) setState(() => _isListening = false);
    }
  }

  Future<void> _chooseImageSource() async {
    if (_isPicking) return;
    setState(() => _showSourceMenu = false);
    final captured = await openSoleLensCapturePage(context);
    if (!mounted || captured == null) return;
    setState(() => _isPicking = true);
    try {
      await _startImageSearchFromFile(
        captured.file,
        source: captured.source,
        requireSubjectSelection: false,
      );
    } finally {
      if (mounted) setState(() => _isPicking = false);
    }
  }

  Future<void> _selectImageSource(ImageSource source) async {
    if (_isPicking) return;
    setState(() => _showSourceMenu = false);
    await _pickImage(source);
  }

  Future<bool> _handleLatestScreenshotDetected(
    LatestScreenshot screenshot,
  ) async {
    if (!mounted) return false;
    final route = ModalRoute.of(context);
    if (route != null && !route.isCurrent) return false;
    if (_isPicking || _homeWaitingForRemote) return false;
    final file = File(screenshot.cachePath);
    if (!await file.exists()) return false;
    setState(() {
      _suggestedScreenshot = screenshot;
      _showSourceMenu = false;
    });
    return true;
  }

  Future<void> _dismissSuggestedScreenshot() async {
    final screenshot = _suggestedScreenshot;
    if (screenshot == null) return;
    await _latestScreenshotDetector.suppress(screenshot);
    if (!mounted) return;
    setState(() => _suggestedScreenshot = null);
  }

  Future<void> _searchSuggestedScreenshot() async {
    final screenshot = _suggestedScreenshot;
    if (screenshot == null || _isPicking) return;
    await _latestScreenshotDetector.suppress(screenshot);
    if (!mounted) return;
    setState(() {
      _suggestedScreenshot = null;
      _isPicking = true;
    });
    try {
      await _startImageSearchFromFile(
        File(screenshot.cachePath),
        source: ImageSource.gallery,
      );
    } finally {
      if (mounted) setState(() => _isPicking = false);
    }
  }

  Future<void> _pickImage(ImageSource source) async {
    if (_isPicking) return;
    setState(() => _isPicking = true);
    try {
      final picked = await _picker.pickImage(
        source: source,
        maxWidth: 1024,
        imageQuality: 70,
      );
      if (!mounted || picked == null) return;

      await _startImageSearchFromFile(File(picked.path), source: source);
    } finally {
      if (mounted) setState(() => _isPicking = false);
    }
  }

  Future<void> _startImageSearchFromFile(
    File sourceFile, {
    required ImageSource source,
    bool requireSubjectSelection = true,
  }) async {
    RecognitionImageSelection? selection;
    if (requireSubjectSelection) {
      selection = await _defaultSubjectSelectionForImage(sourceFile);
      if (!mounted) return;
    }

    final compressedImage = await RecognitionImageCompressor.compress(
      sourceFile,
    );
    debugPrint(
      'recognition image ${compressedImage.originalBytes} -> '
      '${compressedImage.compressedBytes} bytes, '
      'edge=${compressedImage.targetLongEdge}, '
      'quality=${compressedImage.quality}, '
      'fallback=${compressedImage.usedFallback}',
    );

    final imageFile = compressedImage.file;
    final prompt = _promptController.text.trim();
    final pendingRemoteSession = requirementSubmitter.createSessionFromImage(
      imageFile: imageFile,
      source: source,
      selection: selection,
    );
    _promptController.clear();
    if (!mounted) return;
    setState(() {
      _homeHasConversation = true;
      _homeWaitingForRemote = true;
      _lastHomePrompt = prompt.isEmpty ? '图片商品搜索' : prompt;
      _homeMessages.add(
        SoftConversationMessage(
          role: SoftMessageRole.user,
          text: prompt.isEmpty ? '我上传了一张图片，帮我找同款或相似商品。' : prompt,
          createdAt: DateTime.now(),
        ),
      );
      _homeMessages.add(
        SoftConversationMessage(
          role: SoftMessageRole.assistant,
          text: '正在识别图片并检索候选商品。',
          createdAt: DateTime.now(),
        ),
      );
      _saveCurrentThread();
    });

    await _openConversation(
      FigmaResultsPage(
        imageFile: imageFile,
        initialPrompt: prompt,
        initialSubjectSelection: selection,
        pendingRemoteSession: pendingRemoteSession,
        onConversationUpdate: _applyResultConversationUpdate,
      ),
    );
  }

  Future<void> _openConversation(Widget page) async {
    await Navigator.of(context).push(
      PageRouteBuilder<void>(
        transitionDuration: const Duration(milliseconds: 300),
        reverseTransitionDuration: const Duration(milliseconds: 220),
        pageBuilder: (_, animation, __) => FadeTransition(
          opacity: animation,
          child: page,
        ),
      ),
    );
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 2),
        ),
      );
  }

  Future<void> _openUserProfile() async {
    await Navigator.of(context).maybePop();
    if (!mounted) return;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) => UserProfileEditorSheet(
        submitter: requirementSubmitter,
      ),
    );
    if (!mounted || saved != true) return;
    _showMessage('用户画像已更新');
    unawaited(_loadHomeGuideProfile());
  }

  @override
  Widget build(BuildContext context) {
    final topPadding = MediaQuery.of(context).padding.top;
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    return Scaffold(
      drawerScrimColor: Colors.black.withValues(alpha: 0.86),
      drawer: SoftHistoryDrawer(
        threads: _conversationThreads,
        activeThreadId: _activeThreadId,
        onNewChat: () {
          Navigator.of(context).maybePop();
          setState(() {
            _saveCurrentThread();
            _promptController.clear();
            _homeMessages.clear();
            _homeCandidates = const [];
            _homeRemoteSessionId = null;
            _activeThreadId = null;
            _homeHasConversation = false;
            _homeWaitingForRemote = false;
          });
          _queuePersistConversationState();
        },
        onSelectThread: _openThread,
        onOpenUserProfile: _openUserProfile,
      ),
      body: Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () {
                FocusScope.of(context).unfocus();
                if (_showSourceMenu) {
                  setState(() => _showSourceMenu = false);
                }
              },
              child: const DecoratedBox(
                decoration: BoxDecoration(color: _SoftCommerceTheme.canvas),
              ),
            ),
          ),
          if (_homeHasConversation)
            Positioned.fill(
              child: Builder(
                builder: (context) => ListenableBuilder(
                  listenable: sessionShoppingCartStore,
                  builder: (context, _) => FigmaHomeChatState(
                    messages: _homeMessages,
                    candidates: _homeCandidates,
                    isLoading: _homeWaitingForRemote,
                    controller: _promptController,
                    focusNode: _promptFocusNode,
                    isListening: _isListening,
                    isPicking: _isPicking,
                    cartCount: sessionShoppingCartStore.countFor(
                      _activeCartSessionId,
                    ),
                    onMenuPressed: () => Scaffold.of(context).openDrawer(),
                    onCartPressed: _openCurrentCart,
                    onSubmit: _startConversationFromPrompt,
                    onVoicePressed: _startVoiceConversation,
                    onCameraPressed: _chooseImageSource,
                    onOpenResults: _openHomeResults,
                  ),
                ),
              ),
            )
          else
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: Builder(
                builder: (context) => Semantics(
                  label: '当前位置 $_cityLabel',
                  child: FigmaHomeHeader(
                    onMenuPressed: () => Scaffold.of(context).openDrawer(),
                  ),
                ),
              ),
            ),
          if (_shouldShowEmptyHomeGuide)
            Positioned.fill(
              top: topPadding + 96,
              bottom: 104 + bottomPadding,
              child: EmptyHomeGuide(
                recommendations: _homeGuideRecommendations,
                examplePrompt: _homeGuideExamplePrompt,
                onSelected: _handleHomeGuideRecommendation,
              ),
            ),
          if (!_homeHasConversation)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(
                padding: EdgeInsets.fromLTRB(
                  20,
                  12,
                  20,
                  14 + bottomPadding,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFFAFAF8).withValues(alpha: 0.97),
                  border: const Border(
                    top: BorderSide(color: Color(0xFFEAEAE7)),
                  ),
                ),
                child: FigmaHomeComposer(
                  controller: _promptController,
                  focusNode: _promptFocusNode,
                  isListening: _isListening,
                  isPicking: _isPicking,
                  onSubmit: _startConversationFromPrompt,
                  onVoicePressed: _startVoiceConversation,
                  onCameraPressed: _chooseImageSource,
                ),
              ),
            ),
          if (_showSourceMenu)
            Positioned(
              right: 24,
              bottom: 108 + bottomPadding,
              child: FigmaSourcePopover(
                onGallery: () => _selectImageSource(ImageSource.gallery),
                onCamera: () => _selectImageSource(ImageSource.camera),
                onFile: () => _selectImageSource(ImageSource.gallery),
              ),
            ),
          if (_suggestedScreenshot != null)
            Positioned(
              left: 18,
              right: 18,
              bottom: (_homeHasConversation ? 96 : 112) + bottomPadding,
              child: LatestScreenshotPromptCard(
                screenshot: _suggestedScreenshot!,
                isBusy: _isPicking,
                onSearch: _searchSuggestedScreenshot,
                onDismiss: _dismissSuggestedScreenshot,
              ),
            ),
        ],
      ),
    );
  }
}

class LatestScreenshotPromptCard extends StatelessWidget {
  const LatestScreenshotPromptCard({
    required this.screenshot,
    required this.isBusy,
    required this.onSearch,
    required this.onDismiss,
    super.key,
  });

  final LatestScreenshot screenshot;
  final bool isBusy;
  final VoidCallback onSearch;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFFE7E7E7)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.12),
              blurRadius: 22,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: Image.file(
                  File(screenshot.cachePath),
                  width: 74,
                  height: 74,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const SizedBox(
                    width: 74,
                    height: 74,
                    child: DecoratedBox(
                      decoration: BoxDecoration(color: Color(0xFFF1F1F1)),
                      child: Icon(Icons.image_not_supported_outlined),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Expanded(
                          child: Text(
                            '猜你想搜这张图？',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: _SoftCommerceTheme.ink,
                              fontSize: 17,
                              height: 1.18,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 0,
                            ),
                          ),
                        ),
                        IconButton(
                          constraints: const BoxConstraints(
                            minWidth: 32,
                            minHeight: 32,
                          ),
                          padding: EdgeInsets.zero,
                          visualDensity: VisualDensity.compact,
                          icon: const Icon(Icons.close_rounded, size: 20),
                          onPressed: isBusy ? null : onDismiss,
                          tooltip: '关闭',
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      '检测到你刚刚截了一张图，可以直接用它搜索相似商品。',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: _SoftCommerceTheme.muted,
                        fontSize: 13,
                        height: 1.35,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 0,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: isBusy ? null : onSearch,
                            icon: const Icon(Icons.search_rounded, size: 18),
                            label: const Text('立即搜索'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        TextButton(
                          onPressed: isBusy ? null : onDismiss,
                          child: const Text('不是这张'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class EmptyHomeGuide extends StatelessWidget {
  const EmptyHomeGuide({
    required this.recommendations,
    required this.examplePrompt,
    required this.onSelected,
    super.key,
  });

  final List<EmptyHomeGuideRecommendation> recommendations;
  final String examplePrompt;
  final ValueChanged<EmptyHomeGuideRecommendation> onSelected;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final guideWidth = min(constraints.maxWidth - 48, 560.0);
        final contentWidth = max(0.0, guideWidth);
        final chipWidth =
            contentWidth < 340 ? contentWidth : (contentWidth - 16) / 2;
        return SingleChildScrollView(
          physics: constraints.maxHeight < 560
              ? const BouncingScrollPhysics()
              : const NeverScrollableScrollPhysics(),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Align(
              alignment: const Alignment(0, -0.34),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 22,
                ),
                child: SizedBox(
                  width: contentWidth,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const _EmptyHomeGuideIcon(),
                      const SizedBox(height: 30),
                      const Text(
                        '今天想找什么？',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: _SoftCommerceTheme.ink,
                          fontSize: 27,
                          height: 34 / 27,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 0,
                        ),
                      ),
                      const SizedBox(height: 11),
                      const Text(
                        '拍照找同款，或直接说出预算、品牌、场景',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Color(0xFF73736F),
                          fontSize: 15,
                          height: 22 / 15,
                          fontWeight: FontWeight.w500,
                          letterSpacing: 0,
                        ),
                      ),
                      const SizedBox(height: 28),
                      Wrap(
                        spacing: 16,
                        runSpacing: 14,
                        alignment: WrapAlignment.center,
                        children: [
                          for (final item in recommendations)
                            SizedBox(
                              width: chipWidth,
                              child: EmptyHomeGuideChip(
                                recommendation: item,
                                onTap: () => onSelected(item),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 28),
                      EmptyHomeGuideExampleCard(prompt: examplePrompt),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _EmptyHomeGuideIcon extends StatelessWidget {
  const _EmptyHomeGuideIcon();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 124,
      height: 124,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            width: 98,
            height: 98,
            decoration: const BoxDecoration(
              color: Color(0xFFF0F0EE),
              shape: BoxShape.circle,
            ),
          ),
          const Positioned(
            left: 38,
            top: 38,
            child: Icon(
              Icons.camera_alt_outlined,
              color: Color(0xFF777774),
              size: 46,
            ),
          ),
          const Positioned(
            right: 28,
            bottom: 27,
            child: Icon(
              Icons.search_rounded,
              color: Color(0xFF777774),
              size: 44,
            ),
          ),
          const Positioned(
            left: 13,
            top: 52,
            child: _EmptyHomeGuideDot(),
          ),
          const Positioned(
            right: 12,
            top: 38,
            child: _EmptyHomeGuidePlus(),
          ),
          const Positioned(
            left: 28,
            bottom: 27,
            child: _EmptyHomeGuidePlus(),
          ),
          const Positioned(
            right: 20,
            bottom: 54,
            child: _EmptyHomeGuideDot(),
          ),
        ],
      ),
    );
  }
}

class _EmptyHomeGuideDot extends StatelessWidget {
  const _EmptyHomeGuideDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 4,
      height: 4,
      decoration: const BoxDecoration(
        color: Color(0xFFB7B7B4),
        shape: BoxShape.circle,
      ),
    );
  }
}

class _EmptyHomeGuidePlus extends StatelessWidget {
  const _EmptyHomeGuidePlus();

  @override
  Widget build(BuildContext context) {
    return const Text(
      '+',
      style: TextStyle(
        color: Color(0xFFB7B7B4),
        fontSize: 22,
        height: 1,
        fontWeight: FontWeight.w300,
      ),
    );
  }
}

class EmptyHomeGuideChip extends StatelessWidget {
  const EmptyHomeGuideChip({
    required this.recommendation,
    required this.onTap,
    super.key,
  });

  final EmptyHomeGuideRecommendation recommendation;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _SoftCommerceTheme.surface,
      borderRadius: BorderRadius.circular(28),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        borderRadius: BorderRadius.circular(28),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 58),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: const Color(0xFFE2E2DF)),
            color: _SoftCommerceTheme.surface,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                recommendation.icon,
                size: 22,
                color: const Color(0xFF5F5F5B),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    recommendation.label,
                    maxLines: 1,
                    style: const TextStyle(
                      color: Color(0xFF282825),
                      fontSize: 15,
                      height: 21 / 15,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class EmptyHomeGuideExampleCard extends StatelessWidget {
  const EmptyHomeGuideExampleCard({
    required this.prompt,
    super.key,
  });

  final String prompt;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(22, 18, 22, 20),
      decoration: BoxDecoration(
        color: const Color(0xFFF8F8F6),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE8E8E5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.lightbulb_outline_rounded,
                color: Color(0xFF8A8A86),
                size: 21,
              ),
              SizedBox(width: 8),
              Text(
                '试试这样问',
                style: TextStyle(
                  color: Color(0xFF7A7A76),
                  fontSize: 14,
                  height: 20 / 14,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
          const SizedBox(height: 13),
          Text(
            '“ $prompt ”',
            style: const TextStyle(
              color: _SoftCommerceTheme.ink,
              fontSize: 17,
              height: 25 / 17,
              fontWeight: FontWeight.w500,
              letterSpacing: 0,
            ),
          ),
        ],
      ),
    );
  }
}

class FigmaHomeHeader extends StatelessWidget {
  const FigmaHomeHeader({required this.onMenuPressed, super.key});

  final VoidCallback onMenuPressed;

  @override
  Widget build(BuildContext context) {
    return FigmaChatHeader(
      subtitle: '',
      isOnline: backendEnabled,
      isLoading: false,
      cartCount: 0,
      showCart: false,
      onMenuPressed: onMenuPressed,
      onCartPressed: () {},
    );
  }
}

class FigmaHomeComposer extends StatelessWidget {
  const FigmaHomeComposer({
    required this.controller,
    required this.focusNode,
    required this.isListening,
    required this.isPicking,
    required this.onSubmit,
    required this.onVoicePressed,
    required this.onCameraPressed,
    super.key,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool isListening;
  final bool isPicking;
  final VoidCallback onSubmit;
  final VoidCallback onVoicePressed;
  final VoidCallback onCameraPressed;

  @override
  Widget build(BuildContext context) {
    return FigmaChatBottomComposer(
      controller: controller,
      focusNode: focusNode,
      isListening: isListening,
      isPicking: isPicking,
      onSubmit: onSubmit,
      onVoicePressed: onVoicePressed,
      onCameraPressed: onCameraPressed,
    );
  }
}

class FigmaSourcePopover extends StatelessWidget {
  const FigmaSourcePopover({
    required this.onGallery,
    required this.onCamera,
    required this.onFile,
    super.key,
  });

  final VoidCallback onGallery;
  final VoidCallback onCamera;
  final VoidCallback onFile;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 220,
      padding: const EdgeInsets.fromLTRB(22, 20, 18, 18),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(28),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            blurRadius: 44,
            offset: const Offset(0, 20),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          FigmaSourceOption(
            icon: Icons.photo_library_outlined,
            label: '照片图库',
            onTap: onGallery,
          ),
          const SizedBox(height: 20),
          FigmaSourceOption(
            icon: Icons.photo_camera_outlined,
            label: '拍照或录像',
            onTap: onCamera,
          ),
          const SizedBox(height: 20),
          FigmaSourceOption(
            icon: Icons.folder_open_outlined,
            label: '选取文件',
            onTap: onFile,
          ),
        ],
      ),
    );
  }
}

class FigmaSourceOption extends StatelessWidget {
  const FigmaSourceOption({
    required this.icon,
    required this.label,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Row(
          children: [
            Icon(icon, color: const Color(0xFF404040), size: 34),
            const SizedBox(width: 18),
            Text(
              label,
              style: const TextStyle(
                color: Color(0xFF2B2B2B),
                fontSize: 18,
                height: 1.1,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FigmaHomeChatState extends StatefulWidget {
  const FigmaHomeChatState({
    required this.messages,
    required this.candidates,
    required this.isLoading,
    required this.controller,
    required this.focusNode,
    required this.isListening,
    required this.isPicking,
    required this.cartCount,
    required this.onMenuPressed,
    required this.onCartPressed,
    required this.onSubmit,
    required this.onVoicePressed,
    required this.onCameraPressed,
    required this.onOpenResults,
    super.key,
  });

  final List<SoftConversationMessage> messages;
  final List<DemoCandidate> candidates;
  final bool isLoading;
  final TextEditingController controller;
  final FocusNode focusNode;
  final bool isListening;
  final bool isPicking;
  final int cartCount;
  final VoidCallback onMenuPressed;
  final VoidCallback onCartPressed;
  final VoidCallback onSubmit;
  final VoidCallback onVoicePressed;
  final VoidCallback onCameraPressed;
  final void Function(List<DemoCandidate> candidates, String? sessionId)
      onOpenResults;

  @override
  State<FigmaHomeChatState> createState() => _FigmaHomeChatStateState();
}

class _FigmaHomeChatStateState extends State<FigmaHomeChatState> {
  final ScrollController _scrollController = ScrollController();

  String get _activeTask {
    for (final message in widget.messages) {
      if (message.role == SoftMessageRole.user &&
          message.text.trim().isNotEmpty) {
        final text = message.text.trim().replaceAll(RegExp(r'\s+'), ' ');
        return text.length <= 18 ? text : '${text.substring(0, 18)}...';
      }
    }
    return '新的购物需求';
  }

  @override
  void initState() {
    super.initState();
    _scheduleScrollToLatest();
  }

  @override
  void didUpdateWidget(covariant FigmaHomeChatState oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.messages.length != widget.messages.length ||
        oldWidget.candidates.length != widget.candidates.length ||
        oldWidget.isLoading != widget.isLoading) {
      _scheduleScrollToLatest();
    }
  }

  void _scheduleScrollToLatest() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
      );
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    return Stack(
      children: [
        const Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(color: Color(0xFFFAFAF8)),
          ),
        ),
        Column(
          children: [
            FigmaChatHeader(
              subtitle: widget.isLoading ? '正在处理您的需求' : '正在为您寻找 $_activeTask',
              isOnline: backendEnabled,
              isLoading: widget.isLoading,
              cartCount: widget.cartCount,
              onMenuPressed: widget.onMenuPressed,
              onCartPressed: widget.onCartPressed,
            ),
            Expanded(
              child: ListView(
                controller: _scrollController,
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                padding: EdgeInsets.fromLTRB(22, 26, 22, 148 + bottomPadding),
                children: [
                  for (final message in widget.messages) ...[
                    FigmaChatBubble(
                      message: message,
                      onOpenResults: widget.onOpenResults,
                    ),
                    SizedBox(
                      height: message.role == SoftMessageRole.user ? 26 : 22,
                    ),
                  ],
                  if (widget.isLoading) ...[
                    const FigmaChatLoadingRow(),
                    const SizedBox(height: 22),
                  ],
                  if (widget.candidates.isNotEmpty &&
                      !widget.messages.any((message) =>
                          message.resultCandidates.isNotEmpty)) ...[
                    FigmaChatSummaryCard(
                      candidates: widget.candidates,
                      onOpenResults: () => widget.onOpenResults(
                        widget.candidates,
                        null,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: Container(
            padding: EdgeInsets.fromLTRB(20, 12, 20, 14 + bottomPadding),
            decoration: BoxDecoration(
              color: const Color(0xFFFAFAF8).withValues(alpha: 0.97),
              border: const Border(
                top: BorderSide(color: Color(0xFFEAEAE7)),
              ),
            ),
            child: FigmaChatBottomComposer(
              controller: widget.controller,
              focusNode: widget.focusNode,
              isListening: widget.isListening,
              isPicking: widget.isPicking,
              onSubmit: widget.onSubmit,
              onVoicePressed: widget.onVoicePressed,
              onCameraPressed: widget.onCameraPressed,
            ),
          ),
        ),
      ],
    );
  }
}

class FigmaChatHeader extends StatelessWidget {
  const FigmaChatHeader({
    required this.subtitle,
    required this.isOnline,
    required this.isLoading,
    required this.cartCount,
    this.showCart = true,
    required this.onMenuPressed,
    required this.onCartPressed,
    super.key,
  });

  final String subtitle;
  final bool isOnline;
  final bool isLoading;
  final int cartCount;
  final bool showCart;
  final VoidCallback onMenuPressed;
  final VoidCallback onCartPressed;

  @override
  Widget build(BuildContext context) {
    final topPadding = MediaQuery.of(context).padding.top;
    final hasSubtitle = subtitle.trim().isNotEmpty;
    return ClipRect(
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: Container(
          height: topPadding + 82,
          padding: EdgeInsets.fromLTRB(22, topPadding + 14, 22, 12),
          color: const Color(0xFFFAFAF8).withValues(alpha: 0.94),
          child: Row(
            children: [
              Material(
                color: _SoftCommerceTheme.surface,
                shape: const CircleBorder(),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: onMenuPressed,
                  child: const SizedBox(
                    width: 42,
                    height: 42,
                    child: Icon(Icons.menu_rounded, size: 25),
                  ),
                ),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'SoleAI',
                      style: TextStyle(
                        color: _SoftCommerceTheme.ink,
                        fontSize: 22,
                        height: 26 / 22,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0,
                      ),
                    ),
                    if (hasSubtitle) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF7A7A76),
                          fontSize: 11,
                          height: 15 / 11,
                          fontWeight: FontWeight.w500,
                          letterSpacing: 0,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (showCart) ...[
                const SizedBox(width: 10),
                SessionCartIconButton(
                  count: cartCount,
                  onTap: onCartPressed,
                ),
                const SizedBox(width: 10),
              ] else
                const SizedBox(width: 10),
              Container(
                height: 30,
                padding: const EdgeInsets.symmetric(horizontal: 11),
                decoration: BoxDecoration(
                  color: _SoftCommerceTheme.surface,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: const Color(0xFFE8E8E5)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: isLoading
                            ? const Color(0xFFE0AA42)
                            : isOnline
                                ? const Color(0xFF55C79A)
                                : const Color(0xFFB8B8B3),
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      isLoading
                          ? '处理中'
                          : isOnline
                              ? '在线'
                              : '预览',
                      style: const TextStyle(
                        color: Color(0xFF5E5E5A),
                        fontSize: 11,
                        height: 14 / 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SessionCartIconButton extends StatelessWidget {
  const SessionCartIconButton({
    required this.count,
    required this.onTap,
    this.elevated = false,
    super.key,
  });

  final int count;
  final VoidCallback onTap;
  final bool elevated;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: elevated
          ? _SoftCommerceTheme.surface.withValues(alpha: 0.94)
          : _SoftCommerceTheme.surface,
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      elevation: elevated ? 2 : 0,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(
          width: 42,
          height: 42,
          child: Stack(
            alignment: Alignment.center,
            children: [
              const Icon(Icons.shopping_bag_outlined, size: 22),
              if (count > 0)
                Positioned(
                  right: 6,
                  top: 5,
                  child: Container(
                    height: 17,
                    constraints: const BoxConstraints(minWidth: 17),
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: const Color(0xFFE1533D),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: _SoftCommerceTheme.surface),
                    ),
                    child: Text(
                      count > 9 ? '9+' : '$count',
                      style: const TextStyle(
                        color: _SoftCommerceTheme.surface,
                        fontSize: 9,
                        height: 11 / 9,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class SessionShoppingCartPage extends StatefulWidget {
  const SessionShoppingCartPage({
    required this.sessionId,
    required this.title,
    super.key,
  });

  final String sessionId;
  final String title;

  @override
  State<SessionShoppingCartPage> createState() =>
      _SessionShoppingCartPageState();
}

class _SessionShoppingCartPageState extends State<SessionShoppingCartPage> {
  @override
  void initState() {
    super.initState();
    unawaited(sessionShoppingCartStore.refreshSession(widget.sessionId));
  }

  Future<void> _openCartCandidate(DemoCandidate candidate) async {
    await Navigator.of(context).push(
      PageRouteBuilder<void>(
        transitionDuration: const Duration(milliseconds: 260),
        reverseTransitionDuration: const Duration(milliseconds: 200),
        pageBuilder: (_, animation, __) => FadeTransition(
          opacity: animation,
          child: FigmaProductDetailPage(
            candidate: candidate,
            sessionId: widget.sessionId,
            showTrendOutfit: true,
          ),
        ),
      ),
    );
  }

  Future<void> _removeCartCandidate(DemoCandidate candidate) async {
    await sessionShoppingCartStore.removeCandidate(
      sessionId: widget.sessionId,
      candidate: candidate,
    );
  }

  @override
  Widget build(BuildContext context) {
    final topPadding = MediaQuery.of(context).padding.top;
    return Scaffold(
      backgroundColor: _SoftCommerceTheme.canvas,
      body: ListenableBuilder(
        listenable: sessionShoppingCartStore,
        builder: (context, _) {
          final items = sessionShoppingCartStore.itemsFor(widget.sessionId);
          final isRefreshing =
              sessionShoppingCartStore.isRefreshing(widget.sessionId);
          return CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(20, topPadding + 14, 20, 18),
                  child: Row(
                    children: [
                      Material(
                        color: _SoftCommerceTheme.surface,
                        shape: const CircleBorder(),
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          customBorder: const CircleBorder(),
                          onTap: () => Navigator.of(context).maybePop(),
                          child: const SizedBox(
                            width: 42,
                            height: 42,
                            child: Icon(Icons.arrow_back_ios_new_rounded,
                                size: 20),
                          ),
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              '购物车',
                              style: TextStyle(
                                color: _SoftCommerceTheme.ink,
                                fontSize: 26,
                                height: 32 / 26,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '${items.length} 件 · ${widget.title}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: _SoftCommerceTheme.muted,
                                fontSize: 12,
                                height: 16 / 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (isRefreshing)
                        const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: _SoftCommerceTheme.ink,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              if (items.isEmpty)
                const SliverFillRemaining(
                  hasScrollBody: false,
                  child: SessionCartEmptyState(),
                )
              else
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(
                    20,
                    0,
                    20,
                    30 + MediaQuery.of(context).padding.bottom,
                  ),
                  sliver: SliverList.separated(
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final candidate = items[index];
                      return SessionCartProductTile(
                        candidate: candidate,
                        onTap: () => unawaited(_openCartCandidate(candidate)),
                        onRemove: () =>
                            unawaited(_removeCartCandidate(candidate)),
                      );
                    },
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class SessionCartEmptyState extends StatelessWidget {
  const SessionCartEmptyState({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                color: _SoftCommerceTheme.surface,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.shopping_bag_outlined, size: 34),
            ),
            const SizedBox(height: 18),
            const Text(
              '购物车为空',
              style: TextStyle(
                color: _SoftCommerceTheme.ink,
                fontSize: 20,
                height: 26 / 20,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              '在商品流里左滑卡片即可加入当前对话购物车。',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: _SoftCommerceTheme.muted,
                fontSize: 13,
                height: 20 / 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class SessionCartProductTile extends StatelessWidget {
  const SessionCartProductTile({
    required this.candidate,
    required this.onTap,
    required this.onRemove,
    super.key,
  });

  final DemoCandidate candidate;
  final VoidCallback onTap;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _SoftCommerceTheme.surface,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Container(
                  width: 76,
                  height: 88,
                  color: const Color(0xFFF0F0ED),
                  child: ProductThumbnail(
                    imageUrl: candidate.imageUrl,
                    accentColor: candidate.accentColor,
                    iconSize: 30,
                  ),
                ),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      candidate.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: _SoftCommerceTheme.ink,
                        fontSize: 15,
                        height: 21 / 15,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${platformDisplayName(candidate.platform)} · ¥${candidate.amount.toStringAsFixed(0)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: _SoftCommerceTheme.muted,
                        fontSize: 12,
                        height: 16 / 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      '点开查看搭配推荐',
                      style: TextStyle(
                        color: Color(0xFF2E8B57),
                        fontSize: 12,
                        height: 16 / 12,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                onPressed: onRemove,
                icon: const Icon(Icons.close_rounded),
                color: _SoftCommerceTheme.muted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class FigmaChatBubble extends StatelessWidget {
  const FigmaChatBubble({
    required this.message,
    required this.onOpenResults,
    super.key,
  });

  final SoftConversationMessage message;
  final void Function(List<DemoCandidate> candidates, String? sessionId)
      onOpenResults;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == SoftMessageRole.user;
    if (isUser) {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.sizeOf(context).width * 0.72,
          ),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
          decoration: BoxDecoration(
            color: const Color(0xFFEFEFEC),
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(18),
              topRight: Radius.circular(5),
              bottomLeft: Radius.circular(18),
              bottomRight: Radius.circular(18),
            ),
            border: Border.all(color: const Color(0xFFE6E6E2)),
          ),
          child: Text(
            message.text,
            style: const TextStyle(
              color: _SoftCommerceTheme.ink,
              fontSize: 14,
              height: 20 / 14,
              fontWeight: FontWeight.w500,
              letterSpacing: 0,
            ),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SoleAssistantMark(size: 28),
            const SizedBox(width: 12),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  message.text,
                  style: const TextStyle(
                    color: _SoftCommerceTheme.ink,
                    fontSize: 15,
                    height: 24 / 15,
                    fontWeight: FontWeight.w400,
                    letterSpacing: 0,
                  ),
                ),
              ),
            ),
          ],
        ),
        if (message.resultCandidates.isNotEmpty) ...[
          const SizedBox(height: 14),
          FigmaChatSummaryCard(
            candidates: message.resultCandidates,
            onOpenResults: () => onOpenResults(
                message.resultCandidates, message.resultSessionId),
          ),
        ],
      ],
    );
  }
}

class SoleAssistantMark extends StatelessWidget {
  const SoleAssistantMark({required this.size, super.key});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: _SoftCommerceTheme.ink,
        shape: BoxShape.circle,
      ),
      child: Text(
        'S',
        style: TextStyle(
          color: _SoftCommerceTheme.surface,
          fontSize: size * 0.46,
          height: 1,
          fontWeight: FontWeight.w800,
          letterSpacing: 0,
        ),
      ),
    );
  }
}

class FigmaChatLoadingRow extends StatelessWidget {
  const FigmaChatLoadingRow({super.key});

  @override
  Widget build(BuildContext context) {
    return const Row(
      children: [
        SoleAssistantMark(size: 28),
        SizedBox(width: 12),
        SizedBox(
          width: 16,
          height: 16,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: _SoftCommerceTheme.ink,
          ),
        ),
        SizedBox(width: 9),
        Text(
          '正在整理结果',
          style: TextStyle(
            color: Color(0xFF777773),
            fontSize: 13,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class FigmaChatSummaryCard extends StatelessWidget {
  const FigmaChatSummaryCard({
    required this.candidates,
    required this.onOpenResults,
    super.key,
  });

  final List<DemoCandidate> candidates;
  final VoidCallback onOpenResults;

  @override
  Widget build(BuildContext context) {
    final lowestPrice = candidates
        .map((candidate) => candidate.amount)
        .reduce((value, amount) => min(value, amount));
    final previewItems = candidates.take(3).toList(growable: false);
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 12, 10, 12),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE7E7E3)),
      ),
      child: SizedBox(
        height: 52,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            for (final candidate in previewItems) ...[
              FigmaChatProductThumb(candidate: candidate),
              const SizedBox(width: 5),
            ],
            if (candidates.length > previewItems.length)
              Container(
                width: 38,
                height: 48,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: const Color(0xFFF0F0ED),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '+${candidates.length - previewItems.length}',
                  style: const TextStyle(
                    color: Color(0xFF4A4A47),
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            Container(
              width: 1,
              height: 40,
              margin: const EdgeInsets.symmetric(horizontal: 9),
              color: const Color(0xFFE5E5E1),
            ),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${candidates.length} 件候选',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: _SoftCommerceTheme.ink,
                      fontSize: 12,
                      height: 16 / 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '最低 ¥${lowestPrice.toStringAsFixed(0)}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF777773),
                      fontSize: 11,
                      height: 14 / 11,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 6),
            Material(
              color: _SoftCommerceTheme.ink,
              borderRadius: BorderRadius.circular(999),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                borderRadius: BorderRadius.circular(999),
                onTap: onOpenResults,
                child: const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 13, vertical: 10),
                  child: Text(
                    '打开结果',
                    style: TextStyle(
                      color: _SoftCommerceTheme.surface,
                      fontSize: 11,
                      height: 14 / 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FigmaChatProductThumb extends StatelessWidget {
  const FigmaChatProductThumb({required this.candidate, super.key});

  final DemoCandidate candidate;

  @override
  Widget build(BuildContext context) {
    final url = _stableNetworkImageUrl(candidate.imageUrl);
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: 38,
        height: 48,
        color: const Color(0xFFF0F0ED),
        child: url == null
            ? const Icon(
                Icons.shopping_bag_outlined,
                color: Color(0xFF8C8C87),
                size: 20,
              )
            : Image.network(
                url,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => const Icon(
                  Icons.shopping_bag_outlined,
                  color: Color(0xFF8C8C87),
                  size: 20,
                ),
              ),
      ),
    );
  }
}

class FigmaChatCandidateRail extends StatelessWidget {
  const FigmaChatCandidateRail({required this.candidates, super.key});

  final List<DemoCandidate> candidates;

  @override
  Widget build(BuildContext context) {
    final items = candidates;
    final screenSize = MediaQuery.sizeOf(context);
    final scale = min(screenSize.width / 393, 1.0);
    final cardWidth = 280 * scale;
    final imageHeight = min(cardWidth, screenSize.height * 0.22);
    return SizedBox(
      height: imageHeight + 68,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: min(items.length, 3),
        separatorBuilder: (_, __) => const SizedBox(width: 16),
        itemBuilder: (context, index) {
          return FigmaChatCandidateCard(
            candidate: items[index],
            width: cardWidth,
            imageHeight: imageHeight,
          );
        },
      ),
    );
  }
}

class FigmaChatCandidateCard extends StatelessWidget {
  const FigmaChatCandidateCard({
    required this.candidate,
    required this.width,
    required this.imageHeight,
    super.key,
  });

  final DemoCandidate candidate;
  final double width;
  final double imageHeight;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: _SoftCommerceTheme.surface,
          borderRadius: BorderRadius.circular(24),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.06),
              blurRadius: 24,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(24),
          child: Column(
            children: [
              SizedBox(
                width: width,
                height: imageHeight,
                child: Stack(
                  children: [
                    const Positioned.fill(
                      child: DecoratedBox(
                        decoration: BoxDecoration(color: Color(0xFFEEEEEE)),
                      ),
                    ),
                    Positioned(
                      left: 8,
                      top: 8,
                      child: FigmaSmallChip(
                        label: platformDisplayName(candidate.platform),
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                height: 68,
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                color: _SoftCommerceTheme.surface,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      candidate.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: _SoftCommerceTheme.ink,
                        fontSize: 14,
                        height: 20 / 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const Spacer(),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          '${(candidate.matchScore * 100).round()}% 匹配',
                          style: const TextStyle(
                            color: Color(0xFF6E6E6E),
                            fontSize: 11,
                            height: 16 / 11,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const Spacer(),
                        Text(
                          '¥${candidate.amount.toStringAsFixed(0)}',
                          style: const TextStyle(
                            color: _SoftCommerceTheme.ink,
                            fontSize: 16,
                            height: 20 / 16,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class FigmaSmallChip extends StatelessWidget {
  const FigmaSmallChip({required this.label, super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface.withValues(alpha: 0.90),
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 2,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: _SoftCommerceTheme.ink,
          fontSize: 10,
          height: 15 / 10,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class FigmaChatBottomComposer extends StatelessWidget {
  const FigmaChatBottomComposer({
    required this.controller,
    required this.focusNode,
    required this.isListening,
    required this.isPicking,
    required this.onSubmit,
    required this.onVoicePressed,
    required this.onCameraPressed,
    super.key,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool isListening;
  final bool isPicking;
  final VoidCallback onSubmit;
  final VoidCallback onVoicePressed;
  final VoidCallback onCameraPressed;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 62, maxHeight: 108),
      child: Container(
        padding: const EdgeInsets.fromLTRB(6, 6, 6, 6),
        decoration: BoxDecoration(
          color: _SoftCommerceTheme.surface,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: const Color(0xFFE3E3DF)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.07),
              blurRadius: 22,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            SizedBox(
              width: 42,
              height: 46,
              child: IconButton(
                tooltip: '拍照搜索',
                icon: Icon(
                  isPicking
                      ? Icons.hourglass_top_rounded
                      : Icons.camera_alt_outlined,
                ),
                iconSize: 22,
                color: const Color(0xFF595955),
                onPressed: onCameraPressed,
              ),
            ),
            SizedBox(
              width: 42,
              height: 46,
              child: IconButton(
                tooltip: '语音输入',
                icon: Icon(
                  isListening ? Icons.graphic_eq_rounded : Icons.mic_rounded,
                ),
                iconSize: 22,
                color: const Color(0xFF595955),
                onPressed: onVoicePressed,
              ),
            ),
            Container(
              width: 1,
              height: 24,
              margin: const EdgeInsets.only(right: 10),
              color: const Color(0xFFE2E2DE),
            ),
            Expanded(
              child: TextField(
                controller: controller,
                focusNode: focusNode,
                minLines: 1,
                maxLines: 3,
                keyboardType: TextInputType.multiline,
                textInputAction: TextInputAction.newline,
                decoration: const InputDecoration(
                  isDense: true,
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.symmetric(vertical: 11),
                  hintText: '描述想找的商品',
                  hintStyle: TextStyle(
                    color: Color(0xFFA4A49F),
                    fontSize: 14,
                    height: 20 / 14,
                    fontWeight: FontWeight.w400,
                    letterSpacing: 0,
                  ),
                ),
                style: const TextStyle(
                  color: _SoftCommerceTheme.ink,
                  fontSize: 14,
                  height: 20 / 14,
                  fontWeight: FontWeight.w400,
                  letterSpacing: 0,
                ),
              ),
            ),
            const SizedBox(width: 6),
            Material(
              color: _SoftCommerceTheme.ink,
              shape: const CircleBorder(),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: onSubmit,
                child: const SizedBox(
                  width: 48,
                  height: 48,
                  child: Icon(
                    Icons.arrow_upward_rounded,
                    color: _SoftCommerceTheme.surface,
                    size: 27,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FigmaActionPill extends StatelessWidget {
  const FigmaActionPill({
    required this.icon,
    required this.label,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _SoftCommerceTheme.surface,
      borderRadius: BorderRadius.circular(999),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: const Color(0xFFE7E7E7)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.04),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Row(
            children: [
              Icon(icon, size: 18, color: const Color(0xFF6B6B6B)),
              const SizedBox(width: 8),
              Text(
                label,
                style: const TextStyle(
                  color: Color(0xFF6B6B6B),
                  fontSize: 13,
                  height: 18 / 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class FigmaResultsPage extends StatefulWidget {
  const FigmaResultsPage({
    this.imageFile,
    this.initialPrompt = '',
    this.remoteSessionId,
    this.remoteCandidates,
    this.initialSubjectSelection,
    this.pendingRemoteSession,
    this.playInitialRevealAnimation = true,
    this.onConversationUpdate,
    super.key,
  });

  final File? imageFile;
  final String initialPrompt;
  final String? remoteSessionId;
  final List<DemoCandidate>? remoteCandidates;
  final RecognitionImageSelection? initialSubjectSelection;
  final Future<RemoteSessionDraft?>? pendingRemoteSession;
  final bool playInitialRevealAnimation;
  final ValueChanged<FigmaResultConversationUpdate>? onConversationUpdate;

  @override
  State<FigmaResultsPage> createState() => _FigmaResultsPageState();
}

class FigmaResultConversationUpdate {
  const FigmaResultConversationUpdate({
    this.userMessage,
    this.assistantMessage,
    this.sessionId,
    this.candidates = const <DemoCandidate>[],
    this.stateChangingTurn = false,
  });

  final String? userMessage;
  final String? assistantMessage;
  final String? sessionId;
  final List<DemoCandidate> candidates;
  final bool stateChangingTurn;
}

enum FigmaResultSearchStage {
  searching,
  reshuffling,
  dealing,
  complete,
  loadingMore,
}

const double _figmaResultBottomComposerHeight = 62;
const double _figmaResultBottomComposerBottomInset = 16;
const double _figmaResultBottomComposerContentGap = 72;

class _FigmaResultsPageState extends State<FigmaResultsPage> {
  late final TextEditingController _promptController;
  late final ScrollController _scrollController;
  late List<DemoCandidate> _candidates;
  List<DemoCandidate> _displayedCandidates = const [];
  final Set<String> _revealedCandidateIds = <String>{};
  final Map<String, GlobalKey> _candidateKeys = <String, GlobalKey>{};
  final Map<String, Map<String, dynamic>> _candidateDetailPayloads =
      <String, Map<String, dynamic>>{};
  final Map<String, FigmaProductDetailData> _candidateDetailData =
      <String, FigmaProductDetailData>{};
  final Set<String> _candidateDetailPrefetching = <String>{};
  final List<DemoCandidate> _shortlistPool = [];
  SoftBackendSuggestionDraft? _backendSuggestion;
  String? _loadingSuggestionCardId;
  String _sessionId = 'LOCAL-FIGMA-RESULTS';
  String? _nextCursor;
  bool _hasMoreCandidates = true;
  bool _waitingForRemote = false;
  bool _loadingMoreCandidates = false;
  bool _adjustingSubject = false;
  bool _refiningCandidates = false;
  bool _savingProductProfile = false;
  bool _isListening = false;
  bool _isPicking = false;
  DemoCandidate? _activeDetailCandidate;
  Rect? _activeDetailOriginRect;
  ui.Image? _activeDetailFrontSnapshot;
  bool _activeDetailShowsTrendOutfit = false;
  late RecognitionImageSelection _subjectSelection;
  FigmaResultSearchStage _searchStage = FigmaResultSearchStage.searching;
  BackendProductProfile? _productProfile;
  ProductSearchPipelineMode _searchPipelineMode =
      ProductSearchPipelineMode.lightTagAnnFusion;
  String? _remoteFailureMessage;
  int _searchRunId = 0;
  int _gridVersion = 0;

  @override
  void initState() {
    super.initState();
    _promptController = TextEditingController();
    _scrollController = ScrollController()..addListener(_onScroll);
    _sessionId = widget.remoteSessionId ?? _sessionId;
    _subjectSelection =
        widget.initialSubjectSelection ?? _defaultFigmaSubjectSelection;
    _searchPipelineMode = requirementSubmitter.searchPipelineMode;
    sessionShoppingCartStore.addListener(_handleCartStoreChanged);
    unawaited(sessionShoppingCartStore.refreshSession(_sessionId));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _syncShortlistFromCart();
      _jumpResultsSheetToPreviewPosition();
    });
    _hasMoreCandidates =
        !_sessionId.startsWith('LOCAL-') || widget.pendingRemoteSession != null;
    _candidates = widget.remoteCandidates?.isNotEmpty == true
        ? widget.remoteCandidates!
        : const [];
    _waitingForRemote = widget.pendingRemoteSession != null;
    if (_candidates.isNotEmpty &&
        !_waitingForRemote &&
        !widget.playInitialRevealAnimation) {
      _showCandidatesImmediately(_candidates, resetKeys: true);
    }
    if (!_sessionId.startsWith('LOCAL-') && _candidates.isNotEmpty) {
      unawaited(_loadBackendSuggestions());
    }
    _loadPendingRemoteSession();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (_candidates.isNotEmpty && !widget.playInitialRevealAnimation) {
        return;
      }
      if (_candidates.isNotEmpty || !_waitingForRemote) {
        unawaited(_runCandidateReveal(_candidates, isMore: false));
      }
    });
  }

  @override
  void dispose() {
    sessionShoppingCartStore.removeListener(_handleCartStoreChanged);
    _activeDetailFrontSnapshot?.dispose();
    _clearCandidateDetailCaches();
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _promptController.dispose();
    super.dispose();
  }

  Future<void> _loadPendingRemoteSession() async {
    final pending = widget.pendingRemoteSession;
    if (pending == null) return;
    final remote = await pending;
    final remoteCandidates = remote?.candidates ?? const <DemoCandidate>[];
    final shouldAutoRefine = remote != null &&
        (remote.detailedProfileStatus == 'pending' ||
            remote.detailedProfileStatus == 'running');
    if (remote == null) {
      final failureMessage = requirementSubmitter.lastFailureMessage;
      widget.onConversationUpdate?.call(
        FigmaResultConversationUpdate(
          assistantMessage: failureMessage,
        ),
      );
    } else {
      final assistantMessage = remote.assistantMessage?.trim();
      widget.onConversationUpdate?.call(
        FigmaResultConversationUpdate(
          assistantMessage:
              assistantMessage != null && assistantMessage.isNotEmpty
                  ? assistantMessage
                  : remoteCandidates.isEmpty
                      ? null
                      : '已为您搜索到 ${remoteCandidates.length} 件商品。',
          sessionId: remote.sessionId,
          candidates: remoteCandidates,
          stateChangingTurn: remote.stateChangingTurn,
        ),
      );
    }
    if (!mounted) return;
    setState(() {
      _waitingForRemote = false;
      if (remote != null) {
        _remoteFailureMessage = null;
        _sessionId = remote.sessionId;
        _nextCursor = remote.nextCursor;
        _hasMoreCandidates = remote.hasMore;
        _productProfile = remote.productProfile ?? _productProfile;
        _searchPipelineMode = remote.searchPipelineMode;
        if (remoteCandidates.isNotEmpty) {
          _candidates = remoteCandidates;
        } else {
          _searchStage = FigmaResultSearchStage.complete;
          _displayedCandidates = const [];
          _revealedCandidateIds.clear();
          _hasMoreCandidates = false;
        }
      } else {
        _remoteFailureMessage = requirementSubmitter.lastFailureMessage;
        _hasMoreCandidates = false;
        _searchStage = FigmaResultSearchStage.complete;
      }
    });
    if (remote != null) {
      unawaited(sessionShoppingCartStore.refreshSession(_sessionId));
      unawaited(_loadBackendSuggestions());
    }
    if (remoteCandidates.isNotEmpty) {
      _retainShortlistForCandidates();
      if (widget.playInitialRevealAnimation) {
        unawaited(_runCandidateReveal(remoteCandidates, isMore: false));
      } else {
        setState(() {
          _showCandidatesImmediately(remoteCandidates, resetKeys: true);
        });
      }
    }
    if (remote == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(requirementSubmitter.lastFailureMessage),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 3),
        ),
      );
      return;
    }
    if (shouldAutoRefine) {
      unawaited(_pollForDetailedProfileAndRefresh());
    }
  }

  Future<void> _pollForDetailedProfileAndRefresh() async {
    if (_refiningCandidates ||
        _waitingForRemote ||
        _sessionId.startsWith('LOCAL-')) {
      return;
    }
    final hasVisibleCandidates = _displayedCandidates.isNotEmpty;
    setState(() {
      _refiningCandidates = true;
      if (!hasVisibleCandidates) {
        _waitingForRemote = true;
        _searchStage = FigmaResultSearchStage.searching;
        _candidates = const [];
        _displayedCandidates = const [];
        _revealedCandidateIds.clear();
        _hasMoreCandidates = false;
      }
    });

    RemoteRefineResult? readyResult;
    for (var attempt = 0; attempt < 20 && mounted; attempt += 1) {
      final result = await requirementSubmitter.refineCandidates(
        sessionId: _sessionId,
      );
      if (result?.isReady == true) {
        readyResult = result;
        break;
      }
      if (result?.isFailed == true) break;
      await Future<void>.delayed(const Duration(seconds: 2));
    }
    if (!mounted) return;

    setState(() {
      _refiningCandidates = false;
      if (!hasVisibleCandidates) {
        _waitingForRemote = false;
      }
      _searchStage = FigmaResultSearchStage.complete;
      if (readyResult != null) {
        _productProfile = readyResult.productProfile ?? _productProfile;
        _nextCursor = readyResult.nextCursor;
        _hasMoreCandidates = readyResult.hasMore;
        if (readyResult.candidates.isNotEmpty) {
          _candidates = readyResult.candidates;
          _showCandidatesImmediately(readyResult.candidates, resetKeys: true);
        } else if (!hasVisibleCandidates) {
          _displayedCandidates = const [];
          _revealedCandidateIds.clear();
        }
      }
    });
    if (readyResult == null) return;
    if (readyResult.candidates.isNotEmpty) {
      _retainShortlistForCandidates();
    }
    unawaited(_loadBackendSuggestions());
  }

  void _handleCartStoreChanged() {
    if (!mounted) return;
    _syncShortlistFromCart();
  }

  void _onScroll() {
    final position = _scrollController.position;
    if (position.extentAfter > 120) return;
    unawaited(_loadMoreCandidates());
  }

  Future<void> _loadMoreCandidates() async {
    if (_loadingMoreCandidates ||
        _waitingForRemote ||
        _searchStage != FigmaResultSearchStage.complete ||
        !_hasMoreCandidates ||
        _sessionId.startsWith('LOCAL-')) {
      return;
    }
    setState(() {
      _loadingMoreCandidates = true;
      _searchStage = FigmaResultSearchStage.loadingMore;
    });
    final page = await requirementSubmitter.fetchMoreCandidates(
      sessionId: _sessionId,
      cursor: _nextCursor,
      limit: 30,
    );
    if (!mounted) return;
    if (page == null) {
      setState(() {
        _loadingMoreCandidates = false;
        _hasMoreCandidates = false;
        _searchStage = FigmaResultSearchStage.complete;
      });
      return;
    }
    final existingIds = {
      ..._candidates.map((candidate) => candidate.candidateItemId),
      ..._shortlistPool.map((candidate) => candidate.candidateItemId),
    };
    final nextItems = page.candidates
        .where((candidate) => existingIds.add(candidate.candidateItemId))
        .toList(growable: false);
    setState(() {
      _nextCursor = page.nextCursor;
      _hasMoreCandidates = page.hasMore;
      _candidates = [..._candidates, ...nextItems];
    });
    await _runCandidateReveal(nextItems, isMore: true);
  }

  Future<void> _adjustSubjectSelection(
    RecognitionImageSelection selection,
  ) async {
    if (_adjustingSubject ||
        widget.imageFile == null ||
        _sessionId.startsWith('LOCAL-')) {
      return;
    }

    setState(() {
      _subjectSelection = selection;
      _adjustingSubject = true;
      _waitingForRemote = true;
      _searchStage = FigmaResultSearchStage.searching;
    });
    final page = await requirementSubmitter.updateSubjectSelection(
      sessionId: _sessionId,
      selection: selection,
    );
    if (!mounted) return;
    setState(() {
      _adjustingSubject = false;
      _waitingForRemote = false;
      if (page != null) {
        _nextCursor = page.nextCursor;
        _hasMoreCandidates = page.hasMore;
        if (page.candidates.isNotEmpty) {
          _candidates = page.candidates;
        }
      }
    });
    if (page != null && page.candidates.isNotEmpty) {
      _retainShortlistForCandidates();
    }
    if (page != null && page.candidates.isNotEmpty) {
      await _runCandidateReveal(page.candidates, isMore: false);
    } else {
      setState(() => _searchStage = FigmaResultSearchStage.complete);
    }
    unawaited(_loadBackendSuggestions());
  }

  // ignore: unused_element
  Future<void> _refineCandidates() async {
    if (_refiningCandidates ||
        _waitingForRemote ||
        _sessionId.startsWith('LOCAL-')) {
      return;
    }
    setState(() {
      _refiningCandidates = true;
      _waitingForRemote = true;
      _searchStage = FigmaResultSearchStage.searching;
    });

    final result = await requirementSubmitter.refineCandidates(
      sessionId: _sessionId,
    );
    if (!mounted) return;

    if (result == null) {
      setState(() {
        _refiningCandidates = false;
        _waitingForRemote = false;
        _searchStage = FigmaResultSearchStage.complete;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('暂时无法进行更精准匹配，请稍后再试。'),
          behavior: SnackBarBehavior.floating,
          duration: Duration(seconds: 3),
        ),
      );
      return;
    }

    if (result.isPending) {
      setState(() {
        _refiningCandidates = false;
        _waitingForRemote = false;
        _searchStage = FigmaResultSearchStage.complete;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('详细识别还在进行中，稍后再点更精准匹配。'),
          behavior: SnackBarBehavior.floating,
          duration: Duration(seconds: 3),
        ),
      );
      return;
    }

    if (result.isFailed) {
      setState(() {
        _refiningCandidates = false;
        _waitingForRemote = false;
        _searchStage = FigmaResultSearchStage.complete;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('详细识别失败，当前先保留快速匹配结果。'),
          behavior: SnackBarBehavior.floating,
          duration: Duration(seconds: 3),
        ),
      );
      return;
    }

    setState(() {
      _refiningCandidates = false;
      _waitingForRemote = false;
      _productProfile = result.productProfile ?? _productProfile;
      _nextCursor = result.nextCursor;
      _hasMoreCandidates = result.hasMore;
      _candidates = result.candidates;
      if (result.candidates.isEmpty) {
        _displayedCandidates = const [];
        _revealedCandidateIds.clear();
      }
    });
    if (result.candidates.isNotEmpty) {
      _retainShortlistForCandidates();
    }
    if (result.candidates.isNotEmpty) {
      await _runCandidateReveal(result.candidates, isMore: false);
    } else {
      setState(() => _searchStage = FigmaResultSearchStage.complete);
    }
    unawaited(_loadBackendSuggestions());
  }

  Future<void> _loadBackendSuggestions() async {
    if (_sessionId.startsWith('LOCAL-')) return;
    final suggestions = await requirementSubmitter.fetchSessionSuggestions(
      _sessionId,
    );
    if (!mounted || suggestions == null) return;
    setState(() => _backendSuggestion = suggestions);
  }

  Future<void> _editProductProfile() async {
    final profile = _productProfile;
    if (profile == null || _sessionId.startsWith('LOCAL-')) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('识别标签还没有准备好'),
          behavior: SnackBarBehavior.floating,
          duration: Duration(seconds: 2),
        ),
      );
      return;
    }
    final updated = await showModalBottomSheet<BackendProductProfile>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => ProductProfileEditSheet(profile: profile),
    );
    if (!mounted || updated == null) return;
    await _saveProductProfile(updated);
  }

  Future<void> _setPipelineMode(ProductSearchPipelineMode mode) async {
    if (_searchPipelineMode == mode || _savingProductProfile) return;
    requirementSubmitter.searchPipelineMode = mode;
    setState(() => _searchPipelineMode = mode);
    final profile = _productProfile;
    if (profile != null && !_sessionId.startsWith('LOCAL-')) {
      await _saveProductProfile(profile);
    }
  }

  Future<void> _saveProductProfile(BackendProductProfile profile) async {
    if (_savingProductProfile || _sessionId.startsWith('LOCAL-')) return;
    setState(() {
      _savingProductProfile = true;
      _waitingForRemote = true;
      _searchStage = FigmaResultSearchStage.searching;
    });
    final page = await requirementSubmitter.updateProductProfile(
      sessionId: _sessionId,
      profile: profile,
    );
    if (!mounted) return;
    if (page == null) {
      setState(() {
        _savingProductProfile = false;
        _waitingForRemote = false;
        _searchStage = FigmaResultSearchStage.complete;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(requirementSubmitter.lastFailureMessage),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 3),
        ),
      );
      return;
    }
    setState(() {
      _savingProductProfile = false;
      _waitingForRemote = false;
      _searchPipelineMode = page.searchPipelineMode;
      _productProfile = page.productProfile ?? profile;
      _nextCursor = page.nextCursor;
      _hasMoreCandidates = page.hasMore;
      if (page.candidates.isNotEmpty) {
        _candidates = page.candidates;
      }
    });
    if (page.candidates.isNotEmpty) {
      _retainShortlistForCandidates();
      await _runCandidateReveal(page.candidates, isMore: false);
    } else {
      setState(() => _searchStage = FigmaResultSearchStage.complete);
    }
  }

  Future<void> _runCandidateReveal(
    List<DemoCandidate> candidates, {
    required bool isMore,
  }) async {
    final runId = ++_searchRunId;
    final shortlistedIds = _shortlistPool
        .map((candidate) => candidate.candidateItemId)
        .where((candidateId) => candidateId.isNotEmpty)
        .toSet();
    final incoming = _rankCandidates(
      candidates
          .where((candidate) =>
              !shortlistedIds.contains(candidate.candidateItemId))
          .toList(growable: false),
    );
    if (incoming.isEmpty) {
      if (!mounted || runId != _searchRunId) return;
      setState(() {
        _loadingMoreCandidates = false;
        _searchStage = FigmaResultSearchStage.complete;
      });
      return;
    }
    if (!isMore) {
      _clearCandidateDetailCaches();
    }
    _bindCandidateDetails(incoming);

    setState(() {
      _searchStage = isMore
          ? FigmaResultSearchStage.loadingMore
          : FigmaResultSearchStage.dealing;
      if (!isMore) {
        _candidateKeys.clear();
        _displayedCandidates = incoming;
        _revealedCandidateIds.clear();
      }
    });

    await Future<void>.delayed(isMore
        ? const Duration(milliseconds: 120)
        : const Duration(milliseconds: 220));

    final revealItems = isMore
        ? incoming
            .where((candidate) =>
                !_revealedCandidateIds.contains(candidate.candidateItemId))
            .toList(growable: false)
        : incoming;
    for (final candidate in revealItems) {
      if (!mounted || runId != _searchRunId) return;
      if (isMore &&
          !_displayedCandidates.any(
            (item) => item.candidateItemId == candidate.candidateItemId,
          )) {
        setState(() {
          _displayedCandidates = [..._displayedCandidates, candidate];
        });
      }
      await Future<void>.delayed(const Duration(milliseconds: 130));
      if (!mounted || runId != _searchRunId) return;
      setState(() {
        _revealedCandidateIds.add(candidate.candidateItemId);
      });
      unawaited(_scrollCandidateToCenter(candidate.candidateItemId));
      await Future<void>.delayed(const Duration(milliseconds: 260));
    }

    if (!isMore) {
      await Future<void>.delayed(const Duration(milliseconds: 360));
      if (!mounted || runId != _searchRunId) return;
      await _scrollResultsToTop();
    }

    if (!mounted || runId != _searchRunId) return;
    setState(() {
      _displayedCandidates = _rankCandidates(_displayedCandidates);
      _searchStage = FigmaResultSearchStage.complete;
      _loadingMoreCandidates = false;
      _gridVersion += 1;
    });
  }

  Future<void> _scrollCandidateToCenter(String candidateId) async {
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted) return;
    final context = _candidateKeys[candidateId]?.currentContext;
    if (context == null || !context.mounted) return;
    await Scrollable.ensureVisible(
      context,
      duration: const Duration(milliseconds: 360),
      curve: Curves.easeOutCubic,
      alignment: 0.45,
    );
  }

  Future<void> _scrollResultsToTop() async {
    if (!_scrollController.hasClients) return;
    await _scrollController.animateTo(
      _resultsSheetPreviewScrollOffset(),
      duration: const Duration(milliseconds: 520),
      curve: Curves.easeOutCubic,
    );
  }

  void _jumpResultsSheetToPreviewPosition() {
    if (widget.imageFile == null || !_scrollController.hasClients) return;
    _scrollController.jumpTo(_resultsSheetPreviewScrollOffset());
  }

  double _resultsSheetPreviewScrollOffset() {
    if (widget.imageFile == null) return 0;
    final heroHeight = figmaResultHeroHeight(context);
    final topSpacer = heroHeight - 24;
    final targetTop = MediaQuery.sizeOf(context).height * 0.32;
    final targetOffset = max(0.0, topSpacer - targetTop);
    if (!_scrollController.hasClients) return targetOffset;
    final position = _scrollController.position;
    return targetOffset
        .clamp(position.minScrollExtent, position.maxScrollExtent)
        .toDouble();
  }

  void _collectCardsForShuffle() {
    if (_displayedCandidates.isEmpty) return;
    setState(() {
      _searchStage = FigmaResultSearchStage.reshuffling;
      _revealedCandidateIds.clear();
      _gridVersion += 1;
    });
  }

  void _restoreDisplayedCardsAfterNoChange() {
    if (_displayedCandidates.isEmpty) return;
    setState(() {
      _revealedCandidateIds
        ..clear()
        ..addAll(
          _displayedCandidates.map((candidate) => candidate.candidateItemId),
        );
      _searchStage = FigmaResultSearchStage.complete;
      _gridVersion += 1;
    });
  }

  List<DemoCandidate> _rankCandidates(List<DemoCandidate> candidates) {
    final ranked = candidates.toList(growable: false);
    ranked.sort(compareCandidatesByMatch);
    return ranked;
  }

  List<DemoCandidate> get _visibleCandidates => _displayedCandidates;

  bool get _showLoadingBackCards =>
      (_waitingForRemote || _searchStage == FigmaResultSearchStage.searching) &&
      _displayedCandidates.isEmpty;

  String get _resultStatusTitle {
    if (_waitingForRemote && _displayedCandidates.isEmpty) return '正在搜索商品';
    if (_remoteFailureMessage != null && _displayedCandidates.isEmpty) {
      return '图片搜索失败';
    }
    if (_refiningCandidates && _displayedCandidates.isEmpty) {
      return '正在进行更精准匹配';
    }
    if (_searchStage == FigmaResultSearchStage.complete &&
        _displayedCandidates.isEmpty) {
      return '暂未找到匹配商品';
    }
    return switch (_searchStage) {
      FigmaResultSearchStage.searching => '正在按匹配度搜索商品',
      FigmaResultSearchStage.loadingMore => '正在按匹配度搜索更多商品',
      FigmaResultSearchStage.reshuffling => '正在按您的要求重新排序',
      FigmaResultSearchStage.dealing => '正在发回最新商品卡片',
      FigmaResultSearchStage.complete =>
        '已为您搜索到 ${_displayedCandidates.length} 件商品',
    };
  }

  bool get _resultStatusBusy => _searchStage != FigmaResultSearchStage.complete;

  Future<void> _submitPrompt([String? quickPrompt]) async {
    if (_waitingForRemote || _refiningCandidates || _loadingMoreCandidates) {
      return;
    }
    final prompt = (quickPrompt ?? _promptController.text).trim();
    if (prompt.isEmpty) return;
    FocusScope.of(context).unfocus();
    _collectCardsForShuffle();
    widget.onConversationUpdate?.call(
      FigmaResultConversationUpdate(
        userMessage: prompt,
        sessionId: _sessionId,
        candidates: _candidates,
      ),
    );
    setState(() => _waitingForRemote = true);
    final remote = await requirementSubmitter.submitSessionTurnPage(
      sessionId: _sessionId,
      text: prompt,
    );
    if (remote == null) {
      final failureMessage = requirementSubmitter.lastFailureMessage;
      widget.onConversationUpdate?.call(
        FigmaResultConversationUpdate(
          assistantMessage: failureMessage,
          sessionId: _sessionId,
          candidates: _candidates,
        ),
      );
      if (!mounted) return;
      setState(() {
        _waitingForRemote = false;
        _promptController.clear();
      });
      _restoreDisplayedCardsAfterNoChange();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(failureMessage),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 3),
        ),
      );
      return;
    }
    final assistantMessage = remote.assistantMessage?.trim();
    final resolvedAssistantMessage =
        assistantMessage != null && assistantMessage.isNotEmpty
            ? assistantMessage
            : remote.stateChangingTurn && remote.candidates.isEmpty
                ? '没有找到符合这次条件的商品，我先保留当前候选结果。'
                : remote.stateChangingTurn && remote.candidates.isNotEmpty
                    ? '已按您的新要求更新为 ${remote.candidates.length} 个候选商品。'
                    : null;
    widget.onConversationUpdate?.call(
      FigmaResultConversationUpdate(
        assistantMessage: resolvedAssistantMessage,
        sessionId: _sessionId,
        candidates:
            remote.candidates.isNotEmpty ? remote.candidates : _candidates,
        stateChangingTurn: remote.stateChangingTurn,
      ),
    );
    if (!mounted) return;
    setState(() {
      _waitingForRemote = false;
      _promptController.clear();
    });
    if (resolvedAssistantMessage != null &&
        resolvedAssistantMessage.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(resolvedAssistantMessage),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 3),
        ),
      );
    }
    if (!remote.stateChangingTurn) {
      _restoreDisplayedCardsAfterNoChange();
      unawaited(_loadBackendSuggestions());
      return;
    }
    setState(() {
      _nextCursor = remote.nextCursor;
      _hasMoreCandidates = remote.hasMore;
      if (remote.candidates.isNotEmpty) {
        _candidates = remote.candidates;
      }
    });
    if (remote.candidates.isNotEmpty) {
      _retainShortlistForCandidates();
    }
    if (remote.candidates.isNotEmpty) {
      unawaited(_runCandidateReveal(remote.candidates, isMore: false));
    } else {
      _restoreDisplayedCardsAfterNoChange();
    }
    unawaited(_loadBackendSuggestions());
  }

  Future<void> _executeSuggestionAction(SoftSuggestionAction action) async {
    if (_loadingSuggestionCardId != null || _waitingForRemote) return;
    final loadingKey = action.cardId.isNotEmpty ? action.cardId : action.title;
    setState(() => _loadingSuggestionCardId = loadingKey);
    try {
      switch (action.actionType) {
        case 'submit_turn':
          if (action.prompt.isNotEmpty) {
            await _submitPrompt(action.prompt);
          }
          break;
        case 'open_price_history':
        case 'open_candidate_detail':
          _openCandidateFromSuggestion(action, showTrendOutfit: false);
          break;
        case 'open_trend_outfit':
          _openCandidateFromSuggestion(action, showTrendOutfit: true);
          break;
        case 'open_filter_sheet':
          await _openSuggestionFilterSheet(action);
          break;
        default:
          if (action.prompt.isNotEmpty) {
            await _submitPrompt(action.prompt);
          }
          break;
      }
    } finally {
      if (mounted) setState(() => _loadingSuggestionCardId = null);
    }
  }

  void _openCandidateFromSuggestion(
    SoftSuggestionAction action, {
    required bool showTrendOutfit,
  }) {
    final candidate = _candidateById(action.candidateItemId) ??
        (_displayedCandidates.isNotEmpty ? _displayedCandidates.first : null) ??
        (_candidates.isNotEmpty ? _candidates.first : null);
    if (candidate == null) return;
    final size = MediaQuery.sizeOf(context);
    unawaited(
      _openCandidate(
        candidate,
        Rect.fromCenter(
          center: Offset(size.width / 2, size.height / 2),
          width: min(size.width * 0.72, 260),
          height: min(size.height * 0.46, 380),
        ),
        null,
        showTrendOutfit: showTrendOutfit,
      ),
    );
  }

  DemoCandidate? _candidateById(String? candidateItemId) {
    if (candidateItemId == null || candidateItemId.isEmpty) return null;
    for (final candidate in [..._displayedCandidates, ..._candidates]) {
      if (candidate.candidateItemId == candidateItemId) return candidate;
    }
    return null;
  }

  Future<void> _openSuggestionFilterSheet(SoftSuggestionAction action) async {
    final field = action.field;
    if (field == 'size') {
      final size = await showModalBottomSheet<String>(
        context: context,
        backgroundColor: Colors.transparent,
        builder: (context) => const FigmaSuggestionSizeSheet(),
      );
      if (!mounted || size == null || size.isEmpty) return;
      await _submitPrompt('只看$size码');
      return;
    }
    if (action.prompt.isNotEmpty) {
      await _submitPrompt(action.prompt);
      return;
    }
    _promptController.text = action.title;
    _promptController.selection =
        TextSelection.collapsed(offset: _promptController.text.length);
  }

  Future<void> _startVoiceInput() async {
    if (_isListening) return;
    setState(() => _isListening = true);
    try {
      final text = await voiceChannel.invokeMethod<String>('startListening');
      if (!mounted || text == null || text.trim().isEmpty) return;
      _promptController.text = text.trim();
      _promptController.selection =
          TextSelection.collapsed(offset: _promptController.text.length);
      await _submitPrompt();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('语音输入暂不可用')),
      );
    } finally {
      if (mounted) setState(() => _isListening = false);
    }
  }

  Future<void> _chooseImageSource() async {
    if (_isPicking) return;
    final captured = await openSoleLensCapturePage(context);
    if (!mounted || captured == null) return;
    setState(() => _isPicking = true);
    try {
      await _startImageSearchFromFile(
        captured.file,
        source: captured.source,
        requireSubjectSelection: false,
      );
    } finally {
      if (mounted) setState(() => _isPicking = false);
    }
  }

  Future<void> _startImageSearchFromFile(
    File sourceFile, {
    required ImageSource source,
    bool requireSubjectSelection = true,
  }) async {
    RecognitionImageSelection? selection;
    if (requireSubjectSelection) {
      selection = await _defaultSubjectSelectionForImage(sourceFile);
      if (!mounted) return;
    }

    final compressedImage = await RecognitionImageCompressor.compress(
      sourceFile,
    );
    final imageFile = compressedImage.file;
    final pendingRemoteSession = requirementSubmitter.createSessionFromImage(
      imageFile: imageFile,
      source: source,
      selection: selection,
    );
    widget.onConversationUpdate?.call(
      FigmaResultConversationUpdate(
        userMessage: '我又上传了一张图片，帮我重新找同款或相似商品。',
        sessionId: _sessionId,
        candidates: _candidates,
      ),
    );
    if (!mounted) return;
    await Navigator.of(context).push(
      PageRouteBuilder<void>(
        transitionDuration: const Duration(milliseconds: 260),
        reverseTransitionDuration: const Duration(milliseconds: 200),
        pageBuilder: (_, animation, __) => FadeTransition(
          opacity: animation,
          child: FigmaResultsPage(
            imageFile: imageFile,
            initialSubjectSelection: selection,
            pendingRemoteSession: pendingRemoteSession,
            onConversationUpdate: widget.onConversationUpdate,
          ),
        ),
      ),
    );
  }

  Future<void> _openCandidate(
    DemoCandidate candidate,
    Rect originRect,
    ui.Image? frontSnapshot, {
    bool showTrendOutfit = false,
  }) async {
    setState(() {
      _activeDetailCandidate = candidate;
      _activeDetailOriginRect = originRect;
      _activeDetailFrontSnapshot = frontSnapshot;
      _activeDetailShowsTrendOutfit = showTrendOutfit;
    });
  }

  void _clearActiveDetail() {
    if (!mounted) return;
    final frontSnapshot = _activeDetailFrontSnapshot;
    setState(() {
      _activeDetailCandidate = null;
      _activeDetailOriginRect = null;
      _activeDetailFrontSnapshot = null;
      _activeDetailShowsTrendOutfit = false;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      frontSnapshot?.dispose();
    });
  }

  void _openCandidateFromShortlist(DemoCandidate candidate) {
    final size = MediaQuery.sizeOf(context);
    unawaited(
      _openCandidate(
        candidate,
        Rect.fromCenter(
          center: Offset(size.width / 2, size.height / 2),
          width: min(size.width * 0.72, 260),
          height: min(size.height * 0.46, 380),
        ),
        null,
        showTrendOutfit: true,
      ),
    );
  }

  void _showCandidatesImmediately(
    List<DemoCandidate> candidates, {
    required bool resetKeys,
  }) {
    final ranked = _rankCandidates(candidates);
    if (resetKeys) {
      _candidateKeys.clear();
      _clearCandidateDetailCaches();
    }
    _bindCandidateDetails(ranked);
    _displayedCandidates = ranked;
    _revealedCandidateIds
      ..clear()
      ..addAll(ranked.map((candidate) => candidate.candidateItemId));
    _searchStage = FigmaResultSearchStage.complete;
    _loadingMoreCandidates = false;
    _gridVersion += 1;
  }

  void _bindCandidateDetails(Iterable<DemoCandidate> candidates) {
    for (final candidate in candidates) {
      final candidateId = candidate.candidateItemId;
      _candidateDetailData[candidateId] = _buildCandidateDetailData(candidate);
      _prefetchCandidateDetail(candidate);
    }
  }

  FigmaProductDetailData _buildCandidateDetailData(DemoCandidate candidate) {
    return FigmaProductDetailData.from(
      candidate: candidate,
      detail: _candidateDetailPayloads[candidate.candidateItemId],
      sessionId: _sessionId,
    );
  }

  void _prefetchCandidateDetail(DemoCandidate candidate) {
    final candidateId = candidate.candidateItemId;
    if (_candidateDetailPayloads.containsKey(candidateId) ||
        !_candidateDetailPrefetching.add(candidateId)) {
      return;
    }
    final sessionId = _sessionId;
    unawaited(() async {
      try {
        final payload =
            await requirementSubmitter.fetchCandidateDetail(candidateId);
        if (!mounted || payload == null || sessionId != _sessionId) return;
        final detailData = FigmaProductDetailData.from(
          candidate: candidate,
          detail: payload,
          sessionId: _sessionId,
        );
        _candidateDetailPayloads[candidateId] = payload;
        _candidateDetailData[candidateId] = detailData;
      } finally {
        _candidateDetailPrefetching.remove(candidateId);
      }
    }());
  }

  void _clearCandidateDetailCaches() {
    _candidateDetailPayloads.clear();
    _candidateDetailData.clear();
    _candidateDetailPrefetching.clear();
  }

  void _retainShortlistForCandidates() {
    sessionShoppingCartStore.seedSession(_sessionId, _shortlistPool);
    _syncShortlistFromCart();
  }

  void _syncShortlistFromCart() {
    final cartItems = sessionShoppingCartStore.itemsFor(_sessionId);
    final cartIds = cartItems
        .map((candidate) => candidate.candidateItemId)
        .where((candidateId) => candidateId.isNotEmpty)
        .toSet();
    setState(() {
      _shortlistPool
        ..clear()
        ..addAll(cartItems);
      if (cartIds.isEmpty) return;
      _candidates = _candidates
          .where((item) => !cartIds.contains(item.candidateItemId))
          .toList(growable: false);
      _displayedCandidates = _displayedCandidates
          .where((item) => !cartIds.contains(item.candidateItemId))
          .toList(growable: false);
      _revealedCandidateIds.removeWhere(cartIds.contains);
    });
  }

  void _removeFromShortlist(DemoCandidate candidate) {
    final candidateId = candidate.candidateItemId;
    setState(() {
      _shortlistPool.removeWhere(
        (item) => item.candidateItemId == candidateId,
      );
      if (!_candidates.any((item) => item.candidateItemId == candidateId)) {
        _candidates = [candidate, ..._candidates];
      }
      if (!_displayedCandidates
          .any((item) => item.candidateItemId == candidateId)) {
        _displayedCandidates =
            _rankCandidates([candidate, ..._displayedCandidates]);
        _revealedCandidateIds.add(candidateId);
      }
      _bindCandidateDetails([candidate]);
      _gridVersion += 1;
    });
    unawaited(
      sessionShoppingCartStore.removeCandidate(
        sessionId: _sessionId,
        candidate: candidate,
      ),
    );
  }

  void _shortlistCandidate(DemoCandidate candidate) {
    final candidateId = candidate.candidateItemId;
    var added = false;
    setState(() {
      if (!_shortlistPool.any((item) => item.candidateItemId == candidateId)) {
        _shortlistPool.add(candidate);
        added = true;
      }
      _candidates = _candidates
          .where((item) => item.candidateItemId != candidateId)
          .toList(growable: false);
      _displayedCandidates = _displayedCandidates
          .where((item) => item.candidateItemId != candidateId)
          .toList(growable: false);
      _revealedCandidateIds.remove(candidateId);
      _gridVersion += 1;
    });

    if (added) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text('已加入购物车。'),
            behavior: SnackBarBehavior.floating,
            duration: Duration(seconds: 2),
          ),
        );
    }
    unawaited(
      sessionShoppingCartStore.addCandidate(
        sessionId: _sessionId,
        candidate: candidate,
      ),
    );
  }

  Future<void> _openSessionCart() async {
    await sessionShoppingCartStore.refreshSession(_sessionId);
    if (!mounted) return;
    await Navigator.of(context).push(
      PageRouteBuilder<void>(
        transitionDuration: const Duration(milliseconds: 260),
        reverseTransitionDuration: const Duration(milliseconds: 200),
        pageBuilder: (_, animation, __) => FadeTransition(
          opacity: animation,
          child: SessionShoppingCartPage(
            sessionId: _sessionId,
            title:
                widget.initialPrompt.isEmpty ? '当前对话购物车' : widget.initialPrompt,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    final composerBottom =
        _figmaResultBottomComposerBottomInset + bottomPadding;
    final footerBottomClearance = composerBottom +
        _figmaResultBottomComposerHeight +
        _figmaResultBottomComposerContentGap;
    final hasImageContext = widget.imageFile != null;
    final heroHeight = hasImageContext ? figmaResultHeroHeight(context) : 0.0;
    final topSpacer = hasImageContext
        ? heroHeight - 24
        : MediaQuery.of(context).padding.top + 16;
    final candidates = _visibleCandidates;
    final gridItemCount = _showLoadingBackCards ? 6 : candidates.length;
    return Scaffold(
      backgroundColor: _SoftCommerceTheme.canvas,
      body: Stack(
        children: [
          if (hasImageContext)
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: FigmaResultHero(
                imageFile: widget.imageFile!,
              ),
            ),
          CustomScrollView(
            controller: _scrollController,
            slivers: [
              SliverToBoxAdapter(
                child: SizedBox(height: topSpacer),
              ),
              SliverToBoxAdapter(
                child: Container(
                  padding: EdgeInsets.only(top: hasImageContext ? 16 : 0),
                  decoration: BoxDecoration(
                    color: _SoftCommerceTheme.canvas,
                    borderRadius: hasImageContext
                        ? const BorderRadius.vertical(
                            top: Radius.circular(36),
                          )
                        : BorderRadius.zero,
                  ),
                  child: Column(
                    children: [
                      Container(
                        width: 40,
                        height: 4,
                        decoration: BoxDecoration(
                          color: const Color(0xFFD6D6D6),
                          borderRadius: BorderRadius.circular(999),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(24, 0, 24, 0),
                        child: FigmaResultSummaryHeader(
                          title: _resultStatusTitle,
                          isBusy: _resultStatusBusy,
                        ),
                      ),
                      if (_backendSuggestion?.actions.isNotEmpty == true) ...[
                        const SizedBox(height: 14),
                        Padding(
                          padding: const EdgeInsets.only(left: 24),
                          child: FigmaResultRecommendationRail(
                            suggestion: _backendSuggestion,
                            loadingActionId: _loadingSuggestionCardId,
                            onSelected: (action) =>
                                unawaited(_executeSuggestionAction(action)),
                          ),
                        ),
                      ],
                      if (widget.imageFile != null) ...[
                        const SizedBox(height: 12),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 24),
                          child: ProductSearchProfilePanel(
                            profile: _productProfile,
                            pipelineMode: _searchPipelineMode,
                            isSaving: _savingProductProfile,
                            onEdit: _editProductProfile,
                            onModeChanged: _setPipelineMode,
                          ),
                        ),
                      ],
                      if (_shortlistPool.isNotEmpty) ...[
                        const SizedBox(height: 14),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 24),
                          child: FigmaResultShortlistStrip(
                            candidates: _shortlistPool,
                            onOpen: _openCandidateFromShortlist,
                            onRemove: _removeFromShortlist,
                          ),
                        ),
                      ],
                      const SizedBox(height: 22),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 420),
                        switchInCurve: Curves.easeOutCubic,
                        switchOutCurve: Curves.easeInCubic,
                        child: GridView.builder(
                          key: ValueKey(_gridVersion),
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          padding: const EdgeInsets.fromLTRB(24, 0, 24, 32),
                          itemCount: gridItemCount,
                          gridDelegate:
                              const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 2,
                            crossAxisSpacing: 16,
                            mainAxisSpacing: 16,
                            childAspectRatio: 163 / 296,
                          ),
                          itemBuilder: (context, index) {
                            if (_showLoadingBackCards) {
                              return const FigmaResultProductCardBack();
                            }
                            final candidate = candidates[index];
                            final isActive =
                                _activeDetailCandidate?.candidateItemId ==
                                    candidate.candidateItemId;
                            final isRevealed = _revealedCandidateIds
                                .contains(candidate.candidateItemId);
                            final candidateKey = _candidateKeys.putIfAbsent(
                              candidate.candidateItemId,
                              GlobalKey.new,
                            );
                            return KeyedSubtree(
                              key: candidateKey,
                              child: Dismissible(
                                key: ValueKey(
                                  'figma-shortlist-${candidate.candidateItemId}',
                                ),
                                direction: isRevealed && !isActive
                                    ? DismissDirection.endToStart
                                    : DismissDirection.none,
                                dismissThresholds: const {
                                  DismissDirection.endToStart: 0.32,
                                },
                                background: const SizedBox.shrink(),
                                secondaryBackground:
                                    FigmaShortlistSwipeBackground(
                                  candidate: candidate,
                                ),
                                onDismissed: (_) =>
                                    _shortlistCandidate(candidate),
                                child: Opacity(
                                  opacity: isActive ? 0 : 1,
                                  child: FigmaResultRevealCard(
                                    candidate: candidate,
                                    isRevealed: isRevealed,
                                    onTap: isRevealed && !isActive
                                        ? (originRect, frontSnapshot) =>
                                            _openCandidate(
                                              candidate,
                                              originRect,
                                              frontSnapshot,
                                            )
                                        : null,
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                      Padding(
                        padding:
                            EdgeInsets.fromLTRB(0, 0, 0, footerBottomClearance),
                        child: Center(
                          child: Text(
                            _resultStatusBusy
                                ? _resultStatusTitle
                                : _remoteFailureMessage != null &&
                                        _displayedCandidates.isEmpty
                                    ? _remoteFailureMessage!
                                    : !_hasMoreCandidates
                                        ? '暂无更多匹配'
                                        : '已经展示 ${_displayedCandidates.length} 件商品，下拉查看更多',
                            style: const TextStyle(
                              color: Color(0xFFA0A0A0),
                              fontSize: 13,
                              height: 18 / 13,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          if (hasImageContext)
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              height: heroHeight,
              child: ListenableBuilder(
                listenable: _scrollController,
                builder: (context, _) {
                  final scrollOffset = _scrollController.hasClients
                      ? _scrollController.offset
                          .clamp(0.0, heroHeight)
                          .toDouble()
                      : 0.0;
                  final visiblePhotoHeight = (topSpacer - scrollOffset)
                      .clamp(0.0, heroHeight)
                      .toDouble();
                  final isPhotoFullyExposed = scrollOffset <= 1;
                  final canSubmitSelection = isPhotoFullyExposed &&
                      !_adjustingSubject &&
                      !_sessionId.startsWith('LOCAL-');
                  return IgnorePointer(
                    ignoring: !isPhotoFullyExposed,
                    child: ClipRect(
                      child: FigmaSubjectSelectionOverlay(
                        imageFile: widget.imageFile!,
                        selection: _subjectSelection,
                        isAdjusting: _adjustingSubject,
                        visibleHeight: visiblePhotoHeight,
                        enabled: isPhotoFullyExposed,
                        canSubmit: canSubmitSelection,
                        onSelectionChanged: (selection) {
                          setState(() => _subjectSelection = selection);
                        },
                        onSelectionSubmitted: (selection) {
                          unawaited(_adjustSubjectSelection(selection));
                        },
                      ),
                    ),
                  );
                },
              ),
            ),
          if (!_sessionId.startsWith('LOCAL-'))
            Positioned(
              right: 20,
              top: MediaQuery.of(context).padding.top + 12,
              child: ListenableBuilder(
                listenable: sessionShoppingCartStore,
                builder: (context, _) => SessionCartIconButton(
                  count: sessionShoppingCartStore.countFor(_sessionId),
                  onTap: () => unawaited(_openSessionCart()),
                  elevated: true,
                ),
              ),
            ),
          Positioned(
            left: 24,
            right: 24,
            bottom: composerBottom,
            child: FigmaResultBottomComposer(
              controller: _promptController,
              isListening: _isListening,
              isPicking: _isPicking,
              isSubmitting: _waitingForRemote,
              onSubmit: _submitPrompt,
              onVoicePressed: _startVoiceInput,
              onCameraPressed: _chooseImageSource,
            ),
          ),
          if (_activeDetailCandidate != null && _activeDetailOriginRect != null)
            FigmaProductFlipOverlay(
              candidate: _activeDetailCandidate!,
              sessionId: _sessionId,
              originRect: _activeDetailOriginRect!,
              frontSnapshot: _activeDetailFrontSnapshot,
              showTrendOutfit: _activeDetailShowsTrendOutfit,
              onClose: _clearActiveDetail,
            ),
        ],
      ),
    );
  }
}

class FigmaResultHero extends StatelessWidget {
  const FigmaResultHero({
    required this.imageFile,
    super.key,
  });

  final File imageFile;

  @override
  Widget build(BuildContext context) {
    final heroHeight = figmaResultHeroHeight(context);
    return SizedBox(
      height: heroHeight,
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(
          bottom: Radius.circular(32),
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.file(imageFile, fit: BoxFit.cover),
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Color(0x33000000),
                    Color(0x00000000),
                    Color(0x33000000),
                  ],
                ),
              ),
            ),
            Positioned(
              left: 24,
              top: MediaQuery.of(context).padding.top + 14,
              child: const Text(
                'SoleAI',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  height: 28 / 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FigmaAdjustSelectionButton extends StatelessWidget {
  const FigmaAdjustSelectionButton({
    required this.isAdjusting,
    required this.onTap,
    super.key,
  });

  final bool isAdjusting;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.92),
      borderRadius: BorderRadius.circular(999),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: isAdjusting ? null : onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 8,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                isAdjusting
                    ? Icons.hourglass_top_rounded
                    : Icons.crop_free_rounded,
                size: 18,
                color: _SoftCommerceTheme.ink,
              ),
              const SizedBox(width: 6),
              Text(
                isAdjusting ? '更新中' : '调整框选',
                style: const TextStyle(
                  color: _SoftCommerceTheme.ink,
                  fontSize: 12,
                  height: 16 / 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class FigmaPreciseMatchButton extends StatelessWidget {
  const FigmaPreciseMatchButton({
    required this.isRunning,
    required this.isDisabled,
    required this.onTap,
    super.key,
  });

  final bool isRunning;
  final bool isDisabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: isDisabled ? const Color(0xFFEDEDE9) : _SoftCommerceTheme.ink,
      borderRadius: BorderRadius.circular(999),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: isDisabled ? null : onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                isRunning
                    ? Icons.hourglass_top_rounded
                    : Icons.manage_search_rounded,
                size: 18,
                color: isDisabled
                    ? const Color(0xFF8C8C8C)
                    : _SoftCommerceTheme.surface,
              ),
              const SizedBox(width: 7),
              Text(
                isRunning ? '精细匹配中' : '更精准匹配',
                style: TextStyle(
                  color: isDisabled
                      ? const Color(0xFF8C8C8C)
                      : _SoftCommerceTheme.surface,
                  fontSize: 13,
                  height: 18 / 13,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

double figmaResultHeroHeight(BuildContext context) {
  final size = MediaQuery.sizeOf(context);
  return max(560.0, min(size.height * 0.904, size.width * 769.59 / 390));
}

class FigmaSubjectSelectionOverlay extends StatefulWidget {
  const FigmaSubjectSelectionOverlay({
    required this.imageFile,
    required this.selection,
    required this.visibleHeight,
    required this.enabled,
    required this.canSubmit,
    required this.isAdjusting,
    required this.onSelectionChanged,
    required this.onSelectionSubmitted,
    super.key,
  });

  final File imageFile;
  final RecognitionImageSelection selection;
  final double visibleHeight;
  final bool enabled;
  final bool canSubmit;
  final bool isAdjusting;
  final ValueChanged<RecognitionImageSelection> onSelectionChanged;
  final ValueChanged<RecognitionImageSelection> onSelectionSubmitted;

  @override
  State<FigmaSubjectSelectionOverlay> createState() =>
      _FigmaSubjectSelectionOverlayState();
}

class _FigmaSubjectSelectionOverlayState
    extends State<FigmaSubjectSelectionOverlay> {
  Size? _imageSize;
  RecognitionImageSelection? _latestSelection;

  RecognitionImageSelection get _activeSelection =>
      _latestSelection ?? widget.selection;

  @override
  void initState() {
    super.initState();
    _latestSelection = widget.selection;
    unawaited(_loadImageSize());
  }

  @override
  void didUpdateWidget(covariant FigmaSubjectSelectionOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    _latestSelection = widget.selection;
    if (oldWidget.imageFile.path != widget.imageFile.path) {
      _imageSize = null;
      unawaited(_loadImageSize());
    }
  }

  Future<void> _loadImageSize() async {
    final path = widget.imageFile.path;
    ui.Codec? codec;
    ui.Image? image;
    try {
      final bytes = await widget.imageFile.readAsBytes();
      codec = await ui.instantiateImageCodec(bytes);
      final frame = await codec.getNextFrame();
      image = frame.image;
      if (!mounted || widget.imageFile.path != path) return;
      final imageSize = Size(image.width.toDouble(), image.height.toDouble());
      setState(() {
        _imageSize = imageSize;
      });
    } catch (_) {
      if (!mounted || widget.imageFile.path != path) return;
      setState(() => _imageSize = const Size(3, 4));
    } finally {
      image?.dispose();
      codec?.dispose();
    }
  }

  Rect _imageRectFor(Size boxSize) {
    final imageSize = _imageSize ?? const Size(3, 4);
    final fitted = applyBoxFit(BoxFit.cover, imageSize, boxSize);
    return Alignment.center.inscribe(fitted.destination, Offset.zero & boxSize);
  }

  Rect _selectionRectFor(Rect imageRect) {
    final selection = _rectFromRecognitionSelection(_activeSelection);
    return Rect.fromLTWH(
      imageRect.left + selection.left * imageRect.width,
      imageRect.top + selection.top * imageRect.height,
      selection.width * imageRect.width,
      selection.height * imageRect.height,
    );
  }

  void _moveSelection(DragUpdateDetails details, Rect imageRect) {
    if (!widget.enabled || imageRect.width <= 0 || imageRect.height <= 0) {
      return;
    }
    final selection = _rectFromRecognitionSelection(_activeSelection);
    final nextLeft = (selection.left + details.delta.dx / imageRect.width)
        .clamp(0.0, 1.0 - selection.width)
        .toDouble();
    final nextTop = (selection.top + details.delta.dy / imageRect.height)
        .clamp(0.0, 1.0 - selection.height)
        .toDouble();
    _emitSelection(
      Rect.fromLTWH(nextLeft, nextTop, selection.width, selection.height),
    );
  }

  void _resizeSelection(
    DragUpdateDetails details,
    Rect imageRect,
    _SelectionHandle handle,
  ) {
    if (!widget.enabled || imageRect.width <= 0 || imageRect.height <= 0) {
      return;
    }
    final dx = details.delta.dx / imageRect.width;
    final dy = details.delta.dy / imageRect.height;
    final selection = _rectFromRecognitionSelection(_activeSelection);
    var left = selection.left;
    var top = selection.top;
    var right = selection.right;
    var bottom = selection.bottom;

    switch (handle) {
      case _SelectionHandle.topLeft:
        left += dx;
        top += dy;
      case _SelectionHandle.topRight:
        right += dx;
        top += dy;
      case _SelectionHandle.bottomLeft:
        left += dx;
        bottom += dy;
      case _SelectionHandle.bottomRight:
        right += dx;
        bottom += dy;
      case _SelectionHandle.top:
        top += dy;
      case _SelectionHandle.right:
        right += dx;
      case _SelectionHandle.bottom:
        bottom += dy;
      case _SelectionHandle.left:
        left += dx;
    }

    left = left.clamp(0.0, 1.0).toDouble();
    top = top.clamp(0.0, 1.0).toDouble();
    right = right.clamp(0.0, 1.0).toDouble();
    bottom = bottom.clamp(0.0, 1.0).toDouble();

    if (right - left < _minSubjectSelectionSize) {
      if (_isLeftHandle(handle)) {
        left = (right - _minSubjectSelectionSize).clamp(0.0, 1.0).toDouble();
      } else {
        right = (left + _minSubjectSelectionSize).clamp(0.0, 1.0).toDouble();
      }
    }
    if (bottom - top < _minSubjectSelectionSize) {
      if (_isTopHandle(handle)) {
        top = (bottom - _minSubjectSelectionSize).clamp(0.0, 1.0).toDouble();
      } else {
        bottom = (top + _minSubjectSelectionSize).clamp(0.0, 1.0).toDouble();
      }
    }

    _emitSelection(Rect.fromLTRB(left, top, right, bottom));
  }

  bool _isLeftHandle(_SelectionHandle handle) {
    return handle == _SelectionHandle.topLeft ||
        handle == _SelectionHandle.bottomLeft ||
        handle == _SelectionHandle.left;
  }

  bool _isTopHandle(_SelectionHandle handle) {
    return handle == _SelectionHandle.topLeft ||
        handle == _SelectionHandle.topRight ||
        handle == _SelectionHandle.top;
  }

  void _emitSelection(Rect rect) {
    final selection = _recognitionSelectionFromRect(rect);
    setState(() => _latestSelection = selection);
    widget.onSelectionChanged(selection);
  }

  void _submitSelection() {
    if (!widget.canSubmit) return;
    widget.onSelectionSubmitted(_activeSelection);
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: const BorderRadius.vertical(bottom: Radius.circular(32)),
      child: ClipRect(
        clipper: _TopVisibleHeightClipper(widget.visibleHeight),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final boxSize = constraints.biggest;
            final imageRect = _imageRectFor(boxSize);
            final selectionRect = _selectionRectFor(imageRect);
            const confirmButtonSize = 42.0;
            const confirmButtonGap = 10.0;
            final confirmOnRight =
                selectionRect.right + confirmButtonGap + confirmButtonSize <=
                    boxSize.width - 12;
            final confirmLeft = confirmOnRight
                ? selectionRect.right + confirmButtonGap
                : max(12.0,
                    selectionRect.left - confirmButtonGap - confirmButtonSize);
            final confirmTop = (selectionRect.center.dy - confirmButtonSize / 2)
                .clamp(12.0, max(12.0, boxSize.height - confirmButtonSize - 12))
                .toDouble();
            return Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned.fromRect(
                  rect: selectionRect,
                  child: GestureDetector(
                    behavior: HitTestBehavior.translucent,
                    onPanUpdate: widget.enabled
                        ? (details) => _moveSelection(details, imageRect)
                        : null,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.90),
                          width: 2,
                        ),
                        borderRadius: BorderRadius.circular(12),
                        color: Colors.white.withValues(alpha: 0.10),
                      ),
                    ),
                  ),
                ),
                ..._buildHandles(imageRect, selectionRect),
                Positioned(
                  left: confirmLeft,
                  top: confirmTop,
                  width: confirmButtonSize,
                  height: confirmButtonSize,
                  child: _SubjectSelectionConfirmButton(
                    enabled: widget.canSubmit,
                    isBusy: widget.isAdjusting,
                    onTap: _submitSelection,
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  List<Widget> _buildHandles(Rect imageRect, Rect selectionRect) {
    const size = 44.0;
    return [
      _buildHandle(
        imageRect,
        Offset(selectionRect.left, selectionRect.top),
        _SelectionHandle.topLeft,
        size,
      ),
      _buildHandle(
        imageRect,
        Offset(selectionRect.right, selectionRect.top),
        _SelectionHandle.topRight,
        size,
      ),
      _buildHandle(
        imageRect,
        Offset(selectionRect.left, selectionRect.bottom),
        _SelectionHandle.bottomLeft,
        size,
      ),
      _buildHandle(
        imageRect,
        Offset(selectionRect.right, selectionRect.bottom),
        _SelectionHandle.bottomRight,
        size,
      ),
    ];
  }

  Widget _buildHandle(
    Rect imageRect,
    Offset center,
    _SelectionHandle handle,
    double size,
  ) {
    return Positioned(
      left: center.dx - size / 2,
      top: center.dy - size / 2,
      width: size,
      height: size,
      child: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onPanUpdate: widget.enabled
            ? (details) => _resizeSelection(details, imageRect, handle)
            : null,
        child: Center(
          child: Container(
            width: 16,
            height: 16,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFFE6E6E6)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.20),
                  blurRadius: 4,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TopVisibleHeightClipper extends CustomClipper<Rect> {
  const _TopVisibleHeightClipper(this.visibleHeight);

  final double visibleHeight;

  @override
  Rect getClip(Size size) {
    return Rect.fromLTWH(
      0,
      0,
      size.width,
      visibleHeight.clamp(0.0, size.height).toDouble(),
    );
  }

  @override
  bool shouldReclip(covariant _TopVisibleHeightClipper oldClipper) {
    return oldClipper.visibleHeight != visibleHeight;
  }
}

class _SubjectSelectionConfirmButton extends StatelessWidget {
  const _SubjectSelectionConfirmButton({
    required this.enabled,
    required this.isBusy,
    required this.onTap,
  });

  final bool enabled;
  final bool isBusy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final active = enabled && !isBusy;
    return Material(
      color: Colors.white.withValues(alpha: active || isBusy ? 0.94 : 0.54),
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      elevation: 5,
      shadowColor: Colors.black.withValues(alpha: 0.28),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: active ? onTap : null,
        child: Center(
          child: isBusy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.2,
                    color: _SoftCommerceTheme.ink,
                  ),
                )
              : Icon(
                  Icons.check_rounded,
                  size: 24,
                  color: active
                      ? _SoftCommerceTheme.ink
                      : _SoftCommerceTheme.ink.withValues(alpha: 0.42),
                ),
        ),
      ),
    );
  }
}

class FigmaResultSummaryHeader extends StatelessWidget {
  const FigmaResultSummaryHeader({
    required this.title,
    required this.isBusy,
    super.key,
  });

  final String title;
  final bool isBusy;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 220),
            child: Text(
              title,
              key: ValueKey(title),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: _SoftCommerceTheme.ink,
                fontSize: 28,
                height: 36 / 28,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ),
        const SizedBox(width: 12),
        SizedBox(
          width: 28,
          height: 28,
          child: isBusy
              ? const CircularProgressIndicator(
                  strokeWidth: 3,
                  color: _SoftCommerceTheme.ink,
                )
              : Container(
                  margin: const EdgeInsets.all(8),
                  decoration: const BoxDecoration(
                    color: _SoftCommerceTheme.ink,
                    shape: BoxShape.circle,
                  ),
                ),
        ),
      ],
    );
  }
}

class FigmaResultPlatformChips extends StatelessWidget {
  const FigmaResultPlatformChips({
    required this.platforms,
    required this.activePlatform,
    required this.onChanged,
    super.key,
  });

  final List<String> platforms;
  final String activePlatform;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 54,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(24, 6, 24, 8),
        scrollDirection: Axis.horizontal,
        itemCount: platforms.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (context, index) {
          final platform = platforms[index];
          final selected = platform == activePlatform;
          return Material(
            color:
                selected ? _SoftCommerceTheme.ink : _SoftCommerceTheme.surface,
            borderRadius: BorderRadius.circular(999),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              borderRadius: BorderRadius.circular(999),
              onTap: () => onChanged(platform),
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                child: Text(
                  platform,
                  style: TextStyle(
                    color: selected
                        ? _SoftCommerceTheme.surface
                        : _SoftCommerceTheme.ink,
                    fontSize: 14,
                    height: 20 / 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class FigmaResultRecommendationRail extends StatelessWidget {
  const FigmaResultRecommendationRail({
    this.suggestion,
    this.loadingActionId,
    this.onSelected,
    super.key,
  });

  final SoftBackendSuggestionDraft? suggestion;
  final String? loadingActionId;
  final ValueChanged<SoftSuggestionAction>? onSelected;

  @override
  Widget build(BuildContext context) {
    final items = suggestion?.actions.take(6).toList(growable: false) ??
        const <SoftSuggestionAction>[];
    if (items.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 112,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.only(right: 24),
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          final item = items[index];
          final loadingKey = item.cardId.isNotEmpty ? item.cardId : item.title;
          final loading = loadingActionId == loadingKey;
          return Material(
            color: _SoftCommerceTheme.surface,
            borderRadius: BorderRadius.circular(18),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: loading || onSelected == null
                  ? null
                  : () => onSelected!(item),
              child: Container(
                width: 172,
                height: 104,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(
                    color: const Color(0xFFE6E6E6).withValues(alpha: 0.55),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.07),
                      blurRadius: 26,
                      offset: const Offset(0, 12),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          _suggestionIcon(item),
                          size: 19,
                          color: _SoftCommerceTheme.ink,
                        ),
                        const Spacer(),
                        if (loading)
                          const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: _SoftCommerceTheme.ink,
                            ),
                          ),
                      ],
                    ),
                    const Spacer(),
                    Text(
                      item.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: _SoftCommerceTheme.ink,
                        fontSize: 14,
                        height: 20 / 14,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      item.subtitle ?? item.reason ?? '继续决策',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: _SoftCommerceTheme.muted,
                        fontSize: 11,
                        height: 15 / 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  IconData _suggestionIcon(SoftSuggestionAction item) {
    final text =
        '${item.title} ${item.prompt} ${item.actionType}'.toLowerCase();
    if (item.actionType == 'open_trend_outfit' || text.contains('风格')) {
      return Icons.style_rounded;
    }
    if (item.actionType == 'open_price_history' || text.contains('历史')) {
      return Icons.show_chart_rounded;
    }
    if (item.actionType == 'open_filter_sheet' || text.contains('尺码')) {
      return Icons.tune_rounded;
    }
    if (text.contains('stock') || text.contains('有货')) {
      return Icons.inventory_2_rounded;
    }
    if (text.contains('price') ||
        text.contains('预算') ||
        text.contains('低') ||
        text.contains('包邮')) {
      return Icons.currency_yen_rounded;
    }
    if (text.contains('store') || text.contains('店')) {
      return Icons.storefront_rounded;
    }
    return Icons.auto_awesome_rounded;
  }
}

class FigmaSuggestionSizeSheet extends StatelessWidget {
  const FigmaSuggestionSizeSheet({super.key});

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.paddingOf(context).bottom;
    return ClipRRect(
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      child: Material(
        color: _SoftCommerceTheme.surface,
        child: Padding(
          padding: EdgeInsets.fromLTRB(20, 14, 20, 20 + bottomPadding),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 42,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFD8D8D8),
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              const Text(
                '选择鞋码',
                style: TextStyle(
                  color: _SoftCommerceTheme.ink,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final size in const [
                    '35',
                    '36',
                    '37',
                    '38',
                    '39',
                    '40',
                    '41',
                    '42',
                    '43',
                    '44',
                    '45',
                    '46',
                  ])
                    FilterSelectChip(
                      label: size,
                      selected: false,
                      onSelected: () => Navigator.of(context).pop(size),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class FigmaResultAnimatedCard extends StatelessWidget {
  const FigmaResultAnimatedCard({
    required this.child,
    super.key,
  });

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 320),
      curve: Curves.easeOutBack,
      builder: (context, value, child) {
        final opacity = value.clamp(0.0, 1.0);
        return Opacity(
          opacity: opacity,
          child: Transform.scale(
            scale: 0.92 + 0.08 * value,
            child: child,
          ),
        );
      },
      child: child,
    );
  }
}

class FigmaResultShortlistStrip extends StatelessWidget {
  const FigmaResultShortlistStrip({
    required this.candidates,
    required this.onOpen,
    required this.onRemove,
    super.key,
  });

  final List<DemoCandidate> candidates;
  final ValueChanged<DemoCandidate> onOpen;
  final ValueChanged<DemoCandidate> onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE7E4DE)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.style_rounded, size: 19),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  '购物车',
                  style: TextStyle(
                    color: _SoftCommerceTheme.ink,
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              Text(
                '${candidates.length} 件',
                style: const TextStyle(
                  color: _SoftCommerceTheme.muted,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final candidate in candidates) ...[
                  FigmaShortlistChip(
                    candidate: candidate,
                    onOpen: () => onOpen(candidate),
                    onRemove: () => onRemove(candidate),
                  ),
                  const SizedBox(width: 8),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class FigmaShortlistChip extends StatelessWidget {
  const FigmaShortlistChip({
    required this.candidate,
    required this.onOpen,
    required this.onRemove,
    super.key,
  });

  final DemoCandidate candidate;
  final VoidCallback onOpen;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFF5F3EF),
      borderRadius: BorderRadius.circular(999),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onOpen,
        child: Container(
          padding: const EdgeInsets.fromLTRB(10, 7, 8, 7),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: const Color(0xFFE4E0D8)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.style_rounded, size: 14, color: candidate.accentColor),
              const SizedBox(width: 5),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 132),
                child: Text(
                  candidate.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: _SoftCommerceTheme.ink,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 4),
              GestureDetector(
                onTap: onRemove,
                child: const Icon(Icons.close_rounded, size: 14),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class FigmaShortlistSwipeBackground extends StatelessWidget {
  const FigmaShortlistSwipeBackground({required this.candidate, super.key});

  final DemoCandidate candidate;

  @override
  Widget build(BuildContext context) {
    return Container(
      alignment: Alignment.centerRight,
      padding: const EdgeInsets.only(right: 16),
      decoration: BoxDecoration(
        color: candidate.accentColor.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: candidate.accentColor.withValues(alpha: 0.26),
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Icon(Icons.style_rounded, color: candidate.accentColor, size: 22),
          const SizedBox(height: 6),
          const Text(
            '加入购物车',
            style: TextStyle(
              color: _SoftCommerceTheme.ink,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class FigmaResultRevealCard extends StatefulWidget {
  const FigmaResultRevealCard({
    required this.candidate,
    required this.isRevealed,
    this.onTap,
    super.key,
  });

  final DemoCandidate candidate;
  final bool isRevealed;
  final void Function(Rect originRect, ui.Image? frontSnapshot)? onTap;

  @override
  State<FigmaResultRevealCard> createState() => _FigmaResultRevealCardState();
}

class _FigmaResultRevealCardState extends State<FigmaResultRevealCard>
    with SingleTickerProviderStateMixin {
  final GlobalKey _snapshotKey = GlobalKey();
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
      value: widget.isRevealed ? 1 : 0,
    );
  }

  @override
  void didUpdateWidget(covariant FigmaResultRevealCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.isRevealed == widget.isRevealed) return;
    if (widget.isRevealed) {
      unawaited(_controller.forward());
    } else {
      unawaited(_controller.reverse());
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _openCard(Rect originRect) async {
    final onTap = widget.onTap;
    if (onTap == null) return;
    ui.Image? snapshot;
    final boundary = _snapshotKey.currentContext?.findRenderObject()
        as RenderRepaintBoundary?;
    if (boundary != null && boundary.hasSize) {
      try {
        final pixelRatio =
            min(MediaQuery.devicePixelRatioOf(context), 1.25).toDouble();
        snapshot = await boundary.toImage(pixelRatio: pixelRatio);
      } catch (error) {
        debugPrint('capture product card snapshot failed: $error');
      }
    }
    if (!mounted) {
      snapshot?.dispose();
      return;
    }
    onTap(originRect, snapshot);
  }

  @override
  Widget build(BuildContext context) {
    const backFace = RepaintBoundary(
      child: FigmaResultProductCardBack(),
    );
    final frontFace = RepaintBoundary(
      child: FigmaResultProductCard(
        candidate: widget.candidate,
        onTap: widget.onTap == null ? null : _openCard,
      ),
    );
    return RepaintBoundary(
      key: _snapshotKey,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final progress =
              const Cubic(0.4, 0, 0.2, 1).transform(_controller.value);
          final angle = pi * (1 - progress);
          final frontVisible = progress >= 0.5;
          return Transform(
            alignment: Alignment.center,
            filterQuality: FilterQuality.low,
            transform: Matrix4.identity()
              ..setEntry(3, 2, 1 / 1500)
              ..rotateY(frontVisible ? angle : angle + pi),
            child: frontVisible ? frontFace : backFace,
          );
        },
      ),
    );
  }
}

class FigmaResultProductCardBack extends StatelessWidget {
  const FigmaResultProductCardBack({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: const Color(0xFFE6E6E6).withValues(alpha: 0.30),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 12,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        fit: StackFit.expand,
        children: [
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color(0xFFFFFFFF),
                  Color(0xFFF3F3F3),
                  Color(0xFFFFFFFF),
                ],
              ),
            ),
          ),
          Positioned.fill(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: const Color(0xFFF7F7F7),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(
                    color: const Color(0xFFE6E6E6).withValues(alpha: 0.45),
                  ),
                ),
              ),
            ),
          ),
          Center(
            child: Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: _SoftCommerceTheme.ink,
                borderRadius: BorderRadius.circular(999),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.10),
                    blurRadius: 12,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: const Icon(
                Icons.auto_awesome_rounded,
                color: _SoftCommerceTheme.surface,
                size: 22,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class FigmaResultProductCard extends StatelessWidget {
  const FigmaResultProductCard({
    required this.candidate,
    this.onTap,
    super.key,
  });

  final DemoCandidate candidate;
  final void Function(Rect originRect)? onTap;

  @override
  Widget build(BuildContext context) {
    final stockColor = switch (candidate.stockStatus) {
      StockStatus.inStock => const Color(0xFF2E8B57),
      StockStatus.unknown => const Color(0xFFB88900),
      StockStatus.outOfStock => const Color(0xFFD65A5A),
    };
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () {
        final tapHandler = onTap;
        if (tapHandler == null) return;
        final renderObject = context.findRenderObject();
        final fallbackSize = MediaQuery.sizeOf(context);
        final originRect = renderObject is RenderBox && renderObject.hasSize
            ? renderObject.localToGlobal(Offset.zero) & renderObject.size
            : Rect.fromCenter(
                center: Offset(fallbackSize.width / 2, fallbackSize.height / 2),
                width: 163,
                height: 256,
              );
        tapHandler(originRect);
      },
      child: LayoutBuilder(
        builder: (context, constraints) {
          final cardWidth = constraints.maxWidth;
          final imageHeight = cardWidth * 144 / 163;
          final imageCacheWidth = _imageCacheWidthFor(context, cardWidth);
          return Container(
            decoration: BoxDecoration(
              color: _SoftCommerceTheme.surface,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(
                color: const Color(0xFFE6E6E6).withValues(alpha: 0.30),
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.05),
                  blurRadius: 12,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  height: imageHeight,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      FigmaCandidateImage(
                        candidate: candidate,
                        cacheWidth: imageCacheWidth,
                      ),
                      Positioned(
                        left: 12,
                        top: 10,
                        child: FigmaProductPlatformChip(
                          label: platformDisplayName(candidate.platform),
                        ),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          candidate.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: _SoftCommerceTheme.ink,
                            fontSize: 13,
                            height: 18 / 13,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const Spacer(),
                        Row(
                          children: [
                            const Icon(
                              Icons.bolt_rounded,
                              size: 12,
                              color: _SoftCommerceTheme.ink,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              '匹配度 ${(candidate.matchScore * 100).round()}%',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: _SoftCommerceTheme.ink,
                                fontSize: 10,
                                height: 15 / 10,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Expanded(
                              child: Text(
                                '¥${candidate.amount.toStringAsFixed(0)}',
                                style: const TextStyle(
                                  color: _SoftCommerceTheme.ink,
                                  fontSize: 18,
                                  height: 24 / 18,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            Text(
                              candidate.stockLabel,
                              style: TextStyle(
                                color: stockColor,
                                fontSize: 10,
                                height: 15 / 10,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class FigmaProductPlatformChip extends StatelessWidget {
  const FigmaProductPlatformChip({required this.label, super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 2, sigmaY: 2),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.90),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: const Color(0xFFE6E6E6).withValues(alpha: 0.50),
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.05),
                blurRadius: 2,
                offset: const Offset(0, 1),
              ),
            ],
          ),
          child: Text(
            label,
            style: const TextStyle(
              color: _SoftCommerceTheme.ink,
              fontSize: 10,
              height: 15 / 10,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}

class FigmaCandidateImage extends StatelessWidget {
  const FigmaCandidateImage({
    required this.candidate,
    this.cacheWidth,
    super.key,
  });

  final DemoCandidate candidate;
  final int? cacheWidth;

  @override
  Widget build(BuildContext context) {
    final url = _stableNetworkImageUrl(candidate.imageUrl);
    final fallback = _imagePlaceholder();
    return Container(
      color: const Color(0xFFF3F3F3),
      padding: const EdgeInsets.all(16),
      child: url != null
          ? Image.network(
              url,
              fit: BoxFit.contain,
              cacheWidth: cacheWidth,
              filterQuality: FilterQuality.low,
              gaplessPlayback: true,
              errorBuilder: (_, __, ___) => fallback,
            )
          : fallback,
    );
  }

  Widget _imagePlaceholder() {
    return const Center(
      child: Icon(
        Icons.image_not_supported_outlined,
        size: 42,
        color: Color(0xFFB8B8B8),
      ),
    );
  }
}

class FigmaMatchPill extends StatelessWidget {
  const FigmaMatchPill({required this.score, required this.dark, super.key});

  final double score;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final foreground =
        dark ? _SoftCommerceTheme.surface : const Color(0xFFA0A0A0);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: dark ? _SoftCommerceTheme.ink : _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(999),
        border: dark ? null : Border.all(color: const Color(0xFFE6E6E6)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.10),
            blurRadius: 6,
            offset: const Offset(0, 4),
          ),
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.10),
            blurRadius: 4,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.bolt_rounded, size: 11, color: foreground),
          const SizedBox(width: 4),
          Text(
            '匹配 ${(score * 100).round()}%',
            style: TextStyle(
              color: foreground,
              fontSize: 10,
              height: 15 / 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class FigmaProductFlipOverlay extends StatefulWidget {
  const FigmaProductFlipOverlay({
    required this.candidate,
    required this.sessionId,
    required this.originRect,
    required this.frontSnapshot,
    this.showTrendOutfit = false,
    required this.onClose,
    super.key,
  });

  final DemoCandidate candidate;
  final String sessionId;
  final Rect originRect;
  final ui.Image? frontSnapshot;
  final bool showTrendOutfit;
  final VoidCallback onClose;

  @override
  State<FigmaProductFlipOverlay> createState() =>
      _FigmaProductFlipOverlayState();
}

class _FigmaProductFlipOverlayState extends State<FigmaProductFlipOverlay>
    with TickerProviderStateMixin {
  static const _motionCurve = Cubic(0.2, 0.8, 0.2, 1);
  static const _flipCurve = Cubic(0.4, 0, 0.2, 1);

  late final AnimationController _expandController;
  late final AnimationController _flipController;
  late final Animation<double> _overlayOpacity;
  Map<String, dynamic>? _detail;
  TrendOutfitDraft? _trendOutfit;
  bool _closing = false;
  bool _trendLoading = false;

  @override
  void initState() {
    super.initState();
    _expandController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
    _overlayOpacity = CurvedAnimation(
      parent: _expandController,
      curve: Curves.ease,
    );
    _flipController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(_expandController.forward());
      unawaited(_flipAndLoadDetail());
    });
  }

  Future<void> _flipAndLoadDetail() async {
    await _flipController.forward();
    if (!mounted || _closing) return;
    unawaited(_loadDetail());
    if (widget.showTrendOutfit) {
      unawaited(_loadTrendOutfit());
    }
  }

  Future<void> _loadDetail() async {
    final detail = await requirementSubmitter.fetchCandidateDetail(
      widget.candidate.candidateItemId,
    );
    if (!mounted || _closing) return;
    setState(() => _detail = detail);
  }

  Future<void> _loadTrendOutfit() async {
    setState(() => _trendLoading = true);
    final trendOutfit =
        await requirementSubmitter.fetchTrendOutfitRecommendations(
      sessionId: widget.sessionId,
      candidate: widget.candidate,
    );
    if (!mounted || _closing) return;
    setState(() {
      _trendOutfit = trendOutfit;
      _trendLoading = false;
    });
  }

  Future<void> _close() async {
    if (_closing) return;
    _closing = true;
    unawaited(_flipController.reverse());
    await _expandController.reverse();
    if (mounted) widget.onClose();
  }

  @override
  void dispose() {
    _expandController.dispose();
    _flipController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final screenSize = MediaQuery.sizeOf(context);
    final targetWidth = screenSize.width * 0.90;
    final targetHeight = screenSize.height * 0.80;
    final targetRect = Rect.fromLTWH(
      (screenSize.width - targetWidth) / 2,
      (screenSize.height - targetHeight) / 2,
      targetWidth,
      targetHeight,
    );
    final detail = FigmaProductDetailData.from(
      candidate: widget.candidate,
      detail: _detail,
      sessionId: widget.sessionId,
    );
    final frontFace = RepaintBoundary(
      child: widget.frontSnapshot == null
          ? FigmaResultProductCard(
              candidate: widget.candidate,
              onTap: null,
            )
          : RawImage(
              image: widget.frontSnapshot,
              fit: BoxFit.fill,
              filterQuality: FilterQuality.low,
            ),
    );
    final backFace = RepaintBoundary(
      child: FigmaProductDetailFlipCard(
        detail: detail,
        isLoading: false,
        trendOutfit: widget.showTrendOutfit ? _trendOutfit : null,
        trendLoading: widget.showTrendOutfit && _trendLoading,
      ),
    );

    return Positioned.fill(
      child: Stack(
        children: [
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => unawaited(_close()),
            child: FadeTransition(
              opacity: _overlayOpacity,
              child: ClipRect(
                child: BackdropFilter(
                  filter: ui.ImageFilter.blur(sigmaX: 8, sigmaY: 8),
                  child: Container(
                    color: Colors.black.withValues(alpha: 0.40),
                  ),
                ),
              ),
            ),
          ),
          Positioned.fromRect(
            rect: targetRect,
            child: AnimatedBuilder(
              animation: Listenable.merge([_expandController, _flipController]),
              builder: (context, _) {
                final expand = _motionCurve.transform(_expandController.value);
                final flip = _flipCurve.transform(_flipController.value);
                final currentRect =
                    Rect.lerp(widget.originRect, targetRect, expand) ??
                        targetRect;
                final scaleX = currentRect.width / max(targetRect.width, 1.0);
                final scaleY = currentRect.height / max(targetRect.height, 1.0);
                final offset = currentRect.center - targetRect.center;
                final angle = pi * flip;
                final showBack = angle > pi / 2;

                return Transform.translate(
                  offset: offset,
                  child: Transform.scale(
                    alignment: Alignment.center,
                    scaleX: scaleX,
                    scaleY: scaleY,
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () {},
                      onHorizontalDragEnd: (details) {
                        final velocity = details.primaryVelocity ?? 0;
                        if (velocity.abs() > 240) unawaited(_close());
                      },
                      child: Transform(
                        alignment: Alignment.center,
                        filterQuality: FilterQuality.low,
                        transform: Matrix4.identity()
                          ..setEntry(3, 2, 1 / 1500)
                          ..rotateY(angle),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            Opacity(
                              opacity: showBack ? 0 : 1,
                              child: frontFace,
                            ),
                            Opacity(
                              opacity: showBack ? 1 : 0,
                              child: Transform(
                                alignment: Alignment.center,
                                filterQuality: FilterQuality.low,
                                transform: Matrix4.rotationY(pi),
                                child: backFace,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class FigmaProductDetailFlipCard extends StatelessWidget {
  const FigmaProductDetailFlipCard({
    required this.detail,
    required this.isLoading,
    this.trendOutfit,
    this.trendLoading = false,
    super.key,
  });

  final FigmaProductDetailData detail;
  final bool isLoading;
  final TrendOutfitDraft? trendOutfit;
  final bool trendLoading;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: const Color(0xFFE6E6E6).withValues(alpha: 0.30),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 32,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AspectRatio(
                    aspectRatio: 1,
                    child: Container(
                      color: const Color(0xFFF3F3F3),
                      padding: const EdgeInsets.all(22),
                      child: FigmaDetailProductImage(
                        imageUrl: detail.imageUrl,
                        matchScore: detail.matchScore,
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        FigmaFlipDetailTitlePrice(detail: detail),
                        if (isLoading) ...[
                          const SizedBox(height: 14),
                          const LinearProgressIndicator(
                            minHeight: 3,
                            color: _SoftCommerceTheme.ink,
                            backgroundColor: Color(0xFFE8E8E8),
                          ),
                        ],
                        const SizedBox(height: 24),
                        FigmaDetailInfoGrid(detail: detail),
                        if (trendLoading || trendOutfit != null) ...[
                          const SizedBox(height: 32),
                          FigmaDetailSection(
                            title: '网红搭配',
                            child: FigmaTrendOutfitPanel(
                              trendOutfit: trendOutfit,
                              isLoading: trendLoading,
                            ),
                          ),
                        ],
                        const SizedBox(height: 32),
                        FigmaDetailSection(
                          title: '店铺信息',
                          child: FigmaDetailShopCard(detail: detail),
                        ),
                        const SizedBox(height: 32),
                        FigmaDetailSection(
                          title: '历史价格趋势',
                          child: FigmaPriceHistoryCard(detail: detail),
                        ),
                        const SizedBox(height: 32),
                        FigmaDetailSection(
                          title: '服务保障',
                          child: FigmaServiceGuarantees(detail: detail),
                        ),
                        const SizedBox(height: 24),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          FigmaFlipDetailBottomBar(
            detail: detail,
          ),
        ],
      ),
    );
  }
}

class FigmaFlipDetailTitlePrice extends StatelessWidget {
  const FigmaFlipDetailTitlePrice({required this.detail, super.key});

  final FigmaProductDetailData detail;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                detail.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: _SoftCommerceTheme.ink,
                  fontSize: 18,
                  height: 24 / 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                detail.subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF5E5E5E),
                  fontSize: 15,
                  height: 22 / 15,
                  fontWeight: FontWeight.w400,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 16),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              detail.priceText,
              maxLines: 1,
              style: const TextStyle(
                color: _SoftCommerceTheme.ink,
                fontSize: 32,
                height: 32 / 32,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 6),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.bolt_rounded,
                  size: 12,
                  color: Color(0xFF5E5E5E),
                ),
                const SizedBox(width: 3),
                Text(
                  detail.matchLabel.replaceFirst('匹配度 ', ''),
                  style: const TextStyle(
                    color: Color(0xFF5E5E5E),
                    fontSize: 10,
                    height: 15 / 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ],
        ),
      ],
    );
  }
}

class FigmaFlipDetailBottomBar extends StatelessWidget {
  const FigmaFlipDetailBottomBar({
    required this.detail,
    super.key,
  });

  final FigmaProductDetailData detail;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        border: Border(
          top: BorderSide(
            color: const Color(0xFFE6E6E6).withValues(alpha: 0.30),
          ),
        ),
      ),
      child: Row(
        children: [
          Material(
            color: _SoftCommerceTheme.surface,
            shape: const CircleBorder(),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: () {},
              child: Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFFE6E6E6)),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.04),
                      blurRadius: 18,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: const Icon(Icons.favorite_border_rounded, size: 28),
              ),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: ProductAppJumpButton(
              platform: detail.platform,
              productId: detail.platformProductId,
              productUrl: detail.productUrl,
              brandId: detail.platformBrandId,
            ),
          ),
        ],
      ),
    );
  }
}

class FigmaTrendOutfitPanel extends StatelessWidget {
  const FigmaTrendOutfitPanel({
    required this.trendOutfit,
    required this.isLoading,
    super.key,
  });

  final TrendOutfitDraft? trendOutfit;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    final recommendations =
        trendOutfit?.recommendations.take(4).toList(growable: false) ??
            const <TrendOutfitProductDraft>[];
    final outfitAdvice = trendOutfit?.outfitAdvice ?? const <String>[];
    final visibleAdvice = outfitAdvice.take(4).toList(growable: false);
    if (isLoading && trendOutfit == null) {
      return Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: _SoftCommerceTheme.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFE6E6E6)),
        ),
        child: const Row(
          children: [
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: _SoftCommerceTheme.ink,
              ),
            ),
            SizedBox(width: 12),
            Expanded(
              child: Text(
                '正在读取搭配推荐',
                style: TextStyle(
                  color: _SoftCommerceTheme.ink,
                  fontSize: 13,
                  height: 18 / 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      );
    }

    if (recommendations.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: _SoftCommerceTheme.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFE6E6E6)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              trendOutfit?.trendSummary.isNotEmpty == true
                  ? trendOutfit!.trendSummary
                  : '本地商品池暂时没有匹配到可直接推荐的搭配商品。',
              style: const TextStyle(
                color: _SoftCommerceTheme.muted,
                fontSize: 13,
                height: 20 / 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (visibleAdvice.isNotEmpty) ...[
              const SizedBox(height: 12),
              for (var index = 0; index < visibleAdvice.length; index += 1) ...[
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 5,
                      height: 5,
                      margin: const EdgeInsets.only(top: 8, right: 8),
                      decoration: const BoxDecoration(
                        color: Color(0xFF2E8B57),
                        shape: BoxShape.circle,
                      ),
                    ),
                    Expanded(
                      child: Text(
                        visibleAdvice[index],
                        style: const TextStyle(
                          color: _SoftCommerceTheme.ink,
                          fontSize: 13,
                          height: 20 / 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
                if (index != visibleAdvice.length - 1)
                  const SizedBox(height: 8),
              ],
            ],
          ],
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE6E6E6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (trendOutfit?.trendSummary.isNotEmpty == true) ...[
            Text(
              trendOutfit!.trendSummary,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: _SoftCommerceTheme.muted,
                fontSize: 12,
                height: 18 / 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 12),
          ],
          for (var index = 0; index < recommendations.length; index += 1) ...[
            FigmaTrendOutfitProductCard(
              recommendation: recommendations[index],
            ),
            if (index != recommendations.length - 1) const SizedBox(height: 10),
          ],
        ],
      ),
    );
  }
}

class FigmaTrendOutfitProductCard extends StatelessWidget {
  const FigmaTrendOutfitProductCard({
    required this.recommendation,
    super.key,
  });

  final TrendOutfitProductDraft recommendation;

  @override
  Widget build(BuildContext context) {
    final imageUrl = _stableNetworkImageUrl(recommendation.imageUrl);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Container(
            width: 58,
            height: 68,
            color: const Color(0xFFF0F0ED),
            child: imageUrl == null
                ? const Icon(
                    Icons.checkroom_outlined,
                    size: 25,
                    color: _SoftCommerceTheme.muted,
                  )
                : Image.network(
                    imageUrl,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const Icon(
                      Icons.checkroom_outlined,
                      size: 25,
                      color: _SoftCommerceTheme.muted,
                    ),
                  ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                recommendation.displayCategory.isEmpty
                    ? recommendation.category
                    : recommendation.displayCategory,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF2E8B57),
                  fontSize: 11,
                  height: 14 / 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                recommendation.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: _SoftCommerceTheme.ink,
                  fontSize: 13,
                  height: 18 / 13,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                recommendation.reason.isEmpty
                    ? '可作为当前商品的搭配补充'
                    : recommendation.reason,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: _SoftCommerceTheme.muted,
                  fontSize: 11,
                  height: 16 / 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 10),
        Text(
          recommendation.price <= 0
              ? '¥--'
              : '¥${recommendation.price.toStringAsFixed(0)}',
          style: const TextStyle(
            color: _SoftCommerceTheme.ink,
            fontSize: 14,
            height: 18 / 14,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    );
  }
}

class FigmaResultBottomComposer extends StatelessWidget {
  const FigmaResultBottomComposer({
    required this.controller,
    required this.isListening,
    required this.isPicking,
    required this.isSubmitting,
    required this.onSubmit,
    required this.onVoicePressed,
    required this.onCameraPressed,
    super.key,
  });

  final TextEditingController controller;
  final bool isListening;
  final bool isPicking;
  final bool isSubmitting;
  final VoidCallback onSubmit;
  final VoidCallback onVoicePressed;
  final VoidCallback onCameraPressed;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: Container(
          height: _figmaResultBottomComposerHeight,
          padding: const EdgeInsets.fromLTRB(25, 9, 9, 9),
          decoration: BoxDecoration(
            color: _SoftCommerceTheme.surface.withValues(alpha: 0.80),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: _SoftCommerceTheme.surface.withValues(alpha: 0.50),
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.18),
                blurRadius: 24,
                offset: const Offset(0, 12),
              ),
            ],
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: controller,
                  maxLines: 1,
                  enabled: !isSubmitting,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => onSubmit(),
                  decoration: const InputDecoration(
                    border: InputBorder.none,
                    isDense: true,
                    hintText: '继续收敛：500以内，只看有货',
                    hintStyle: TextStyle(
                      color: Color(0xFFA0A0A0),
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  style: const TextStyle(
                    color: _SoftCommerceTheme.ink,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              SizedBox(
                width: 40,
                height: 40,
                child: IconButton(
                  padding: EdgeInsets.zero,
                  onPressed: isSubmitting ? null : onVoicePressed,
                  icon: Icon(
                    isListening ? Icons.graphic_eq_rounded : Icons.mic_rounded,
                    color: const Color(0xFF5F5F5F),
                    size: 21,
                  ),
                ),
              ),
              const SizedBox(width: 4),
              SizedBox(
                width: 40,
                height: 40,
                child: IconButton(
                  padding: EdgeInsets.zero,
                  onPressed: isSubmitting ? null : onCameraPressed,
                  icon: Icon(
                    isPicking
                        ? Icons.hourglass_top_rounded
                        : Icons.camera_alt_outlined,
                    color: const Color(0xFF5F5F5F),
                    size: 21,
                  ),
                ),
              ),
              const SizedBox(width: 4),
              Material(
                color: _SoftCommerceTheme.ink,
                shape: const CircleBorder(),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: isSubmitting ? null : onSubmit,
                  child: SizedBox(
                    width: 44,
                    height: 44,
                    child: isSubmitting
                        ? const Padding(
                            padding: EdgeInsets.all(13),
                            child: CircularProgressIndicator(
                              strokeWidth: 2.4,
                              color: _SoftCommerceTheme.surface,
                            ),
                          )
                        : const Icon(
                            Icons.arrow_forward_rounded,
                            color: _SoftCommerceTheme.surface,
                            size: 24,
                          ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class FigmaProductDetailPage extends StatefulWidget {
  const FigmaProductDetailPage({
    required this.candidate,
    required this.sessionId,
    this.showTrendOutfit = false,
    super.key,
  });

  final DemoCandidate candidate;
  final String sessionId;
  final bool showTrendOutfit;

  @override
  State<FigmaProductDetailPage> createState() => _FigmaProductDetailPageState();
}

class _FigmaProductDetailPageState extends State<FigmaProductDetailPage> {
  Map<String, dynamic>? _detail;
  TrendOutfitDraft? _trendOutfit;
  bool _detailLoading = false;
  bool _trendLoading = false;

  DemoCandidate get candidate => widget.candidate;
  String get sessionId => widget.sessionId;

  @override
  void initState() {
    super.initState();
    unawaited(_loadDetail());
    if (widget.showTrendOutfit) {
      unawaited(_loadTrendOutfit());
    }
  }

  Future<void> _loadDetail() async {
    final pending = requirementSubmitter.fetchCandidateDetail(
      candidate.candidateItemId,
    );
    setState(() => _detailLoading = true);
    final detail = await pending;
    if (!mounted) return;
    setState(() {
      _detail = detail;
      _detailLoading = false;
    });
  }

  Future<void> _loadTrendOutfit() async {
    setState(() => _trendLoading = true);
    final trendOutfit =
        await requirementSubmitter.fetchTrendOutfitRecommendations(
      sessionId: sessionId,
      candidate: candidate,
    );
    if (!mounted) return;
    setState(() {
      _trendOutfit = trendOutfit;
      _trendLoading = false;
    });
  }

  void _returnBack(BuildContext context) {
    if (Navigator.of(context).canPop()) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    final topPadding = MediaQuery.of(context).padding.top;
    final detail = FigmaProductDetailData.from(
      candidate: candidate,
      detail: _detail,
      sessionId: sessionId,
    );
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onHorizontalDragEnd: (details) {
        if ((details.primaryVelocity ?? 0) > 240) _returnBack(context);
      },
      child: Scaffold(
        backgroundColor: const Color(0xFFF2F2F2),
        body: Stack(
          children: [
            CustomScrollView(
              slivers: [
                SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(
                      24,
                      topPadding + 24,
                      24,
                      116 + bottomPadding,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        FigmaDetailHeroCard(detail: detail),
                        const SizedBox(height: 32),
                        FigmaDetailTitlePrice(detail: detail),
                        const SizedBox(height: 32),
                        FigmaDetailInfoGrid(detail: detail),
                        if (widget.showTrendOutfit ||
                            _trendLoading ||
                            _trendOutfit != null) ...[
                          const SizedBox(height: 32),
                          FigmaDetailSection(
                            title: '网红搭配',
                            child: FigmaTrendOutfitPanel(
                              trendOutfit: _trendOutfit,
                              isLoading: _trendLoading,
                            ),
                          ),
                        ],
                        const SizedBox(height: 32),
                        FigmaDetailSection(
                          title: '店铺信息',
                          child: FigmaDetailShopCard(detail: detail),
                        ),
                        const SizedBox(height: 32),
                        FigmaDetailSection(
                          title: '历史价格趋势',
                          child: FigmaPriceHistoryCard(detail: detail),
                        ),
                        const SizedBox(height: 32),
                        FigmaDetailSection(
                          title: '发货信息',
                          child: FigmaShippingInfoCard(detail: detail),
                        ),
                        const SizedBox(height: 32),
                        FigmaDetailSection(
                          title: '服务保障',
                          child: FigmaServiceGuarantees(detail: detail),
                        ),
                        if (_detailLoading) ...[
                          const SizedBox(height: 24),
                          const FigmaDetailBullet(text: '正在同步后端商品详情。'),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
            Positioned(
              left: 18,
              top: topPadding + 12,
              child: Material(
                color: _SoftCommerceTheme.surface,
                shape: const CircleBorder(),
                clipBehavior: Clip.antiAlias,
                elevation: 2,
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: () => _returnBack(context),
                  child: const SizedBox(
                    width: 46,
                    height: 46,
                    child: Icon(
                      Icons.arrow_back_ios_new_rounded,
                      size: 21,
                      color: _SoftCommerceTheme.ink,
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: FigmaDetailBottomBar(
                detail: detail,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FigmaProductDetailData {
  const FigmaProductDetailData({
    required this.title,
    required this.subtitle,
    required this.priceText,
    required this.currentAmount,
    required this.platform,
    required this.platformLabel,
    required this.platformProductId,
    required this.platformBrandId,
    required this.shopName,
    required this.shopTypeLabel,
    required this.ratingText,
    required this.stockValue,
    required this.stockCaption,
    required this.priceCardValue,
    required this.priceCardCaption,
    required this.shipFrom,
    required this.deliveryEstimate,
    required this.matchLabel,
    required this.matchScore,
    required this.imageUrl,
    required this.productUrl,
    required this.serviceLabels,
    required this.matchBullets,
    required this.historyPoints,
  });

  final String title;
  final String subtitle;
  final String priceText;
  final double currentAmount;
  final String platform;
  final String platformLabel;
  final String? platformProductId;
  final String? platformBrandId;
  final String shopName;
  final String shopTypeLabel;
  final String ratingText;
  final String stockValue;
  final String stockCaption;
  final String priceCardValue;
  final String priceCardCaption;
  final String shipFrom;
  final String deliveryEstimate;
  final String matchLabel;
  final double matchScore;
  final String? imageUrl;
  final String? productUrl;
  final List<String> serviceLabels;
  final List<String> matchBullets;
  final List<double> historyPoints;

  factory FigmaProductDetailData.from({
    required DemoCandidate candidate,
    required Map<String, dynamic>? detail,
    required String sessionId,
  }) {
    final root = <String, dynamic>{
      ...candidate.productPoolData,
      if (detail != null) ...detail,
    };
    final normalized = _softMap(root['normalizedAttributes']);
    final commerce = _softMap(root['commerceMeta']);
    final rating = _softMap(commerce['rating']);
    final sku = _softMap(commerce['sku']);
    final delivery = _softMap(
      root['deliveryEtaReference'] ?? commerce['delivery'],
    );
    final decisionSupport = _softMap(root['decisionSupport']);
    final sortSignals = _softMap(root['sortSignals']);
    final rawPayload = _softMap(root['rawPayload']);
    final productRaw = _softMap(rawPayload['productRawPayload']);
    final shop = _softMap(root['shop']);
    final price = _softMap(root['price']);

    final amount = _detailNumber(price['amount']) ??
        _detailNumber(root['amount']) ??
        candidate.amount;
    final title = _firstNonEmpty([
      root['title'],
      candidate.title,
    ]);
    final platform = _firstNonEmpty([root['platformName'], candidate.platform]);
    final platformLabel = platformDisplayName(platform);
    final shopName = _firstNonEmpty([
      shop['shopName'],
      root['shopName'],
      candidate.shopName,
      '$platformLabel 推荐店铺',
    ]);
    final shopType = _firstNonEmpty([
      shop['shopType'],
      root['shopType'],
      candidate.shopType,
      'unknown',
    ]);
    final ratingValue =
        _detailNumber(rating['overall']) ?? _detailNumber(root['rating']);
    final sizes = _detailStringList(sku['availableSizes']).isNotEmpty
        ? _detailStringList(sku['availableSizes'])
        : _detailStringList(normalized['availableSizes']);
    final stockStatus =
        _firstNonEmpty([root['stockStatus'], candidate.stockStatus.name]);
    final inStock = stockStatus == 'in_stock' ||
        candidate.stockStatus == StockStatus.inStock;
    final firstSize = sizes.isNotEmpty ? sizes.first : null;
    final shipTime = _firstNonEmpty([
      delivery['shipTimeText'],
      productRaw['shipTimeText'],
    ], fallback: '');
    final deliveryTime = _firstNonEmpty([
      delivery['deliveryTimeText'],
      productRaw['deliveryTimeText'],
    ], fallback: '');
    final deliveryDays = _detailNumber(delivery['deliveryDays'])?.round() ??
        candidate.deliveryDays;
    final matchScore = (_detailNumber(sortSignals['relevanceScore']) ??
            _detailNumber(_softMap(root['matchSummary'])['finalScore']) ??
            candidate.matchScore)
        .clamp(0.0, 1.0);
    final priceRank = _detailNumber(decisionSupport['priceRank'])?.round();
    final rawServices = _detailStringList(delivery['serviceLabels']);
    final serviceLabels = <String>[
      ...rawServices,
      if (delivery['sevenDayNoReasonReturn'] == true) '支持七天无理由退货',
      if (delivery['returnShippingInsurance'] == true) '退货免运费',
      if (delivery['freeShipping'] == true) '全场包邮',
    ];
    if (serviceLabels.isEmpty) {
      serviceLabels.addAll([
        if (candidate.stockStatus == StockStatus.inStock) '当前有货',
        if ((root['productUrl'] ?? candidate.productUrl) != null) '可跳转平台',
        '服务以平台为准',
      ]);
    }
    final bullets = <String>[
      _firstNonEmpty([decisionSupport['priorityReason']], fallback: ''),
      _firstNonEmpty([decisionSupport['priceConclusion']], fallback: ''),
      _firstNonEmpty([decisionSupport['stockConclusion']], fallback: ''),
      _firstNonEmpty([decisionSupport['deliveryConclusion']], fallback: ''),
      ...candidate.detailBullets,
    ].where((item) => item.trim().isNotEmpty).toSet().take(5).toList();

    final priceHistory = _firstDetailMap([
      root['priceHistoryReference'],
      root['priceHistory'],
      productRaw['priceHistory'],
      rawPayload['priceHistory'],
    ]);

    return FigmaProductDetailData(
      title: title,
      subtitle: _detailSubtitle(normalized, candidate),
      priceText: '¥${amount.toStringAsFixed(0)}',
      currentAmount: amount,
      platform: platform,
      platformLabel: platformLabel,
      platformProductId: _firstNullableString([
        root['platformProductId'],
        normalized['platformProductId'],
        candidate.platformProductId,
      ]),
      platformBrandId: _firstNullableString([
        root['platformBrandId'],
        normalized['platformBrandId'],
        candidate.platformBrandId,
      ]),
      shopName: shopName,
      shopTypeLabel: _shopTypeLabel(shopType),
      ratingText: ratingValue == null ? '暂无' : ratingValue.toStringAsFixed(1),
      stockValue: inStock
          ? (firstSize == null ? '有货' : '有货 ($firstSize码)')
          : candidate.stockLabel,
      stockCaption: shipTime.isNotEmpty
          ? shipTime
          : inStock
              ? '进入平台确认发货时间'
              : candidate.deliveryLabel,
      priceCardValue: priceRank == 1 ? '当前最低价' : shopName,
      priceCardCaption: _firstNonEmpty([
        decisionSupport['priceConclusion'],
        priceRank == null ? null : '候选池价格排名第 $priceRank',
      ], fallback: '价格以平台详情页为准'),
      shipFrom: _firstNonEmpty([
        delivery['shipFrom'],
        productRaw['geoLocation'],
        productRaw['shipFrom'],
      ], fallback: '待平台确认'),
      deliveryEstimate: deliveryTime.isNotEmpty
          ? deliveryTime
          : deliveryDays <= 1
              ? '最快明日达'
              : '$deliveryDays天',
      matchLabel: '匹配度 ${(matchScore * 100).round()}%',
      matchScore: matchScore,
      imageUrl:
          _firstNullableString([root['coverImageUrl'], candidate.imageUrl]),
      productUrl:
          _firstNullableString([root['productUrl'], candidate.productUrl]),
      serviceLabels: serviceLabels.take(4).toList(growable: false),
      matchBullets: bullets.isEmpty ? candidate.detailBullets : bullets,
      historyPoints: _historyPointsFromDetail(
        priceHistory,
        amount,
        matchScore,
      ),
    );
  }
}

class FigmaDetailHeroCard extends StatelessWidget {
  const FigmaDetailHeroCard({required this.detail, super.key});

  final FigmaProductDetailData detail;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return Container(
          height: constraints.maxWidth * 270.73 / 342,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(36),
            border: Border.all(color: Colors.white),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.08),
                blurRadius: 36,
                offset: const Offset(0, 16),
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            fit: StackFit.expand,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(32, 22, 32, 21),
                child: FigmaDetailProductImage(
                  imageUrl: detail.imageUrl,
                  matchScore: detail.matchScore,
                ),
              ),
              Positioned(
                right: 20,
                top: 20,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: _SoftCommerceTheme.ink,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.bolt_rounded,
                        color: _SoftCommerceTheme.surface,
                        size: 12,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        detail.matchLabel,
                        style: const TextStyle(
                          color: _SoftCommerceTheme.surface,
                          fontSize: 12,
                          height: 16 / 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class FigmaDetailProductImage extends StatelessWidget {
  const FigmaDetailProductImage({
    required this.imageUrl,
    required this.matchScore,
    super.key,
  });

  final String? imageUrl;
  final double matchScore;

  @override
  Widget build(BuildContext context) {
    final url = _stableNetworkImageUrl(imageUrl);
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0, 0.05),
          radius: 0.72,
          colors: [Color(0xFFF8F8F8), Color(0xFFEDEDED)],
        ),
      ),
      child: Center(
        child: _shouldUseNetworkImage(url)
            ? LayoutBuilder(
                builder: (context, constraints) {
                  final cacheWidth =
                      _imageCacheWidthFor(context, constraints.maxWidth);
                  return Image.network(
                    url!,
                    fit: BoxFit.contain,
                    cacheWidth: cacheWidth,
                    filterQuality: FilterQuality.low,
                    gaplessPlayback: true,
                    errorBuilder: (_, __, ___) => const Icon(
                      Icons.image_not_supported_outlined,
                      size: 48,
                      color: Color(0xFFB8B8B8),
                    ),
                  );
                },
              )
            : const Icon(
                Icons.image_not_supported_outlined,
                size: 48,
                color: Color(0xFFB8B8B8),
              ),
      ),
    );
  }

  bool _shouldUseNetworkImage(String? url) {
    return _stableNetworkImageUrl(url) != null;
  }
}

class FigmaDetailTitlePrice extends StatelessWidget {
  const FigmaDetailTitlePrice({required this.detail, super.key});

  final FigmaProductDetailData detail;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                detail.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF1A1C1C),
                  fontSize: 26,
                  height: 35 / 28,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                detail.subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF5E5E5E),
                  fontSize: 15,
                  height: 22.5 / 15,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 18),
        Text(
          detail.priceText,
          maxLines: 1,
          style: const TextStyle(
            color: Colors.black,
            fontSize: 32,
            height: 48 / 32,
            fontWeight: FontWeight.w900,
            letterSpacing: 0,
          ),
        ),
      ],
    );
  }
}

class FigmaDetailInfoGrid extends StatelessWidget {
  const FigmaDetailInfoGrid({required this.detail, super.key});

  final FigmaProductDetailData detail;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: FigmaDetailInfoTile(
            icon: Icons.check_circle_outline_rounded,
            label: '库存状态',
            value: detail.stockValue,
            caption: detail.stockCaption,
            accentColor: const Color(0xFF2E8B57),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: FigmaDetailInfoTile(
            icon: Icons.shopping_bag_outlined,
            label: '全网低价',
            value: detail.priceCardValue,
            caption: detail.priceCardCaption,
            accentColor: _SoftCommerceTheme.ink,
          ),
        ),
      ],
    );
  }
}

class FigmaDetailInfoTile extends StatelessWidget {
  const FigmaDetailInfoTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.caption,
    required this.accentColor,
    super.key,
  });

  final IconData icon;
  final String label;
  final String value;
  final String caption;
  final Color accentColor;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 132),
      child: Container(
        padding: const EdgeInsets.all(21),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: Colors.white),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.08),
              blurRadius: 18,
              offset: const Offset(0, 16),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 18, color: accentColor),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF777777),
                      fontSize: 13,
                      height: 18 / 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              value,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: _SoftCommerceTheme.ink,
                fontSize: 16,
                height: 24 / 16,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              caption,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFFA6A6A6),
                fontSize: 13,
                height: 18 / 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FigmaDetailSection extends StatelessWidget {
  const FigmaDetailSection({
    required this.title,
    required this.child,
    super.key,
  });

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Text(
            title,
            style: const TextStyle(
              color: Color(0xFF1A1C1C),
              fontSize: 16,
              height: 24 / 16,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
        const SizedBox(height: 16),
        child,
      ],
    );
  }
}

class FigmaDetailShopCard extends StatelessWidget {
  const FigmaDetailShopCard({required this.detail, super.key});

  final FigmaProductDetailData detail;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(21),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 18,
            offset: const Offset(0, 16),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    detail.shopName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF1A1C1C),
                      fontSize: 16,
                      height: 24 / 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FigmaShopTypeChip(label: detail.shopTypeLabel),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
            decoration: BoxDecoration(
              color: const Color(0xFFF2F2F2),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: const Color(0xFFE6E6E6)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  '综合评分',
                  style: TextStyle(
                    color: Color(0xFF5E5E5E),
                    fontSize: 13,
                    height: 18 / 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  detail.ratingText,
                  style: const TextStyle(
                    color: Color(0xFF1A1C1C),
                    fontSize: 14,
                    height: 21 / 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class FigmaShopTypeChip extends StatelessWidget {
  const FigmaShopTypeChip({required this.label, super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFFEEEEEE),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: const Color(0xFFE6E6E6)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.verified_rounded, size: 10),
          const SizedBox(width: 2),
          Text(
            label,
            style: const TextStyle(
              color: Colors.black,
              fontSize: 10,
              height: 15 / 10,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class FigmaPriceHistoryCard extends StatelessWidget {
  const FigmaPriceHistoryCard({required this.detail, super.key});

  final FigmaProductDetailData detail;

  @override
  Widget build(BuildContext context) {
    final points = _displayHistoryPoints(
      detail.historyPoints,
      detail.currentAmount,
    );
    final low = points.reduce(min);
    final high = points.reduce(max);
    final positionText = _pricePositionText(detail.currentAmount, low, high);
    final highDropText = _priceHighDropText(detail.currentAmount, high);
    final adviceText = _priceAdviceText(positionText);

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 18,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '价格趋势',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: _SoftCommerceTheme.ink,
                        fontSize: 20,
                        height: 26 / 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '近 90 天 · $positionText',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF858585),
                        fontSize: 13,
                        height: 18 / 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text(
                    '当前价',
                    style: TextStyle(
                      color: Color(0xFF787878),
                      fontSize: 12,
                      height: 17 / 12,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    detail.priceText,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.black,
                      fontSize: 26,
                      height: 30 / 26,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            height: 1,
            color: const Color(0xFFE7E7E7),
          ),
          const SizedBox(height: 7),
          SizedBox(
            height: 102,
            child: CustomPaint(
              painter: FigmaPriceHistoryPainter(
                points: points,
                lowPriceText: '低价 ¥${low.toStringAsFixed(0)}',
              ),
              size: Size.infinite,
            ),
          ),
          const SizedBox(height: 8),
          _PriceHistorySummaryPill(
            highDropText: highDropText,
            adviceText: adviceText,
          ),
        ],
      ),
    );
  }
}

class _PriceHistorySummaryPill extends StatelessWidget {
  const _PriceHistorySummaryPill({
    required this.highDropText,
    required this.adviceText,
  });

  final String highDropText;
  final String adviceText;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 36),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F1F1),
        borderRadius: BorderRadius.circular(999),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const _PriceHistoryPillIcon(icon: Icons.show_chart_rounded),
            const SizedBox(width: 8),
            Text(
              highDropText,
              style: const TextStyle(
                color: Colors.black,
                fontSize: 13,
                height: 18 / 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 12),
            Container(
              width: 1,
              height: 18,
              color: const Color(0xFFCFCFCF),
            ),
            const SizedBox(width: 12),
            const _PriceHistoryPillIcon(icon: Icons.local_offer_outlined),
            const SizedBox(width: 8),
            Text(
              adviceText,
              style: const TextStyle(
                color: Colors.black,
                fontSize: 13,
                height: 18 / 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PriceHistoryPillIcon extends StatelessWidget {
  const _PriceHistoryPillIcon({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 24,
      height: 24,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Icon(
        icon,
        size: 14,
        color: Colors.black,
      ),
    );
  }
}

List<double> _displayHistoryPoints(List<double> source, double currentAmount) {
  final cleaned = source.where((value) => value.isFinite && value > 0).toList();
  if (cleaned.length < 2) return _historyPoints(currentAmount, 0.5);

  final current = max(currentAmount, 1.0);
  final lastPoint = cleaned.last;
  final tolerance = max(current * 0.01, 1.0);
  if ((lastPoint - current).abs() <= tolerance) return cleaned;

  return [...cleaned, current];
}

String _pricePositionText(double current, double low, double high) {
  final span = max(high - low, 1.0);
  final ratio = ((current - low) / span).clamp(0.0, 1.0);
  if (ratio <= 0.28) return '当前处于低位';
  if (ratio >= 0.72) return '当前接近高位';
  return '当前处于中位';
}

String _priceHighDropText(double current, double high) {
  if (high <= current + 0.01) return '接近近期高点';
  final drop = ((high - current) / high * 100).clamp(0.0, 99.9);
  return '比高点低 ${drop.toStringAsFixed(1)}%';
}

String _priceAdviceText(String positionText) {
  if (positionText.contains('低位')) return '建议：可入手';
  if (positionText.contains('中位')) return '建议：可关注';
  return '建议：再观望';
}

class FigmaPriceHistoryPainter extends CustomPainter {
  const FigmaPriceHistoryPainter({
    required this.points,
    required this.lowPriceText,
  });

  final List<double> points;
  final String lowPriceText;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;

    final normalized = points.length < 2 ? const [1.0, 1.08, 1.0] : points;
    final minPoint = normalized.reduce(min);
    final maxPoint = normalized.reduce(max);
    final span = max(maxPoint - minPoint, 1.0);
    final chartRect = Rect.fromLTRB(0, 4, size.width, size.height - 25);
    final lineRect = Rect.fromLTRB(
      chartRect.left,
      chartRect.top + 34,
      chartRect.right,
      chartRect.bottom - 10,
    );

    final gridPaint = Paint()
      ..color = const Color(0xFFE8E8E8)
      ..strokeWidth = 1;
    for (final factor in const [0.05, 0.50, 0.94]) {
      final y = chartRect.top + chartRect.height * factor;
      canvas.drawLine(
        Offset(chartRect.left, y),
        Offset(chartRect.right, y),
        gridPaint,
      );
    }

    final offsets = <Offset>[];
    for (var index = 0; index < normalized.length; index += 1) {
      final x = lineRect.left +
          lineRect.width * index / max(normalized.length - 1, 1);
      final y = lineRect.bottom -
          lineRect.height * ((normalized[index] - minPoint) / span);
      offsets.add(Offset(x, y));
    }

    final path = Path()..moveTo(offsets.first.dx, offsets.first.dy);
    for (final point in offsets.skip(1)) {
      path.lineTo(point.dx, point.dy);
    }

    final shadowPaint = Paint()
      ..color = Colors.black.withValues(alpha: 0.10)
      ..strokeWidth = 4.8
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3);
    final linePaint = Paint()
      ..color = Colors.black.withValues(alpha: 0.96)
      ..strokeWidth = 3.0
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(path, shadowPaint);
    canvas.drawPath(path, linePaint);

    final lowIndex = normalized.indexOf(minPoint);
    final lowOffset = offsets[lowIndex];
    final currentOffset = offsets.last;
    final markerFill = Paint()..color = Colors.white;
    final markerStroke = Paint()
      ..color = Colors.black
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3;
    canvas.drawCircle(lowOffset, 5.8, markerFill);
    canvas.drawCircle(lowOffset, 5.8, markerStroke);

    final currentHaloPaint = Paint()..color = const Color(0xFFF0F0F0);
    final currentOuterPaint = Paint()..color = Colors.white;
    final currentInnerPaint = Paint()..color = Colors.black;
    canvas.drawCircle(currentOffset, 12, currentHaloPaint);
    canvas.drawCircle(currentOffset, 8.5, currentOuterPaint);
    canvas.drawCircle(currentOffset, 6, currentInnerPaint);

    _drawLowPriceBubble(canvas, size, lowOffset);
    _drawAxisLabel(canvas, '3月', Offset(0, size.height - 21), TextAlign.left);
    _drawAxisLabel(
      canvas,
      '5月',
      Offset(size.width / 2, size.height - 21),
      TextAlign.center,
    );
    _drawAxisLabel(
      canvas,
      '现在',
      Offset(size.width, size.height - 21),
      TextAlign.right,
    );
  }

  void _drawLowPriceBubble(Canvas canvas, Size size, Offset marker) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: lowPriceText,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 11,
          height: 16 / 11,
          fontWeight: FontWeight.w700,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final bubbleWidth = textPainter.width + 20;
    const bubbleHeight = 28.0;
    final bubbleLeft = (marker.dx - bubbleWidth / 2)
        .clamp(4.0, max(4.0, size.width - bubbleWidth - 4))
        .toDouble();
    final bubbleTop = (marker.dy - 39).clamp(0.0, size.height - 54).toDouble();
    final bubbleRect = RRect.fromRectAndRadius(
      Rect.fromLTWH(bubbleLeft, bubbleTop, bubbleWidth, bubbleHeight),
      const Radius.circular(18),
    );
    final bubblePaint = Paint()..color = Colors.black.withValues(alpha: 0.95);
    canvas.drawRRect(bubbleRect, bubblePaint);

    final tipX = marker.dx
        .clamp(bubbleLeft + 12, bubbleLeft + bubbleWidth - 12)
        .toDouble();
    final tipPath = Path()
      ..moveTo(tipX - 5, bubbleTop + bubbleHeight - 1)
      ..lineTo(tipX + 5, bubbleTop + bubbleHeight - 1)
      ..lineTo(tipX, bubbleTop + bubbleHeight + 6)
      ..close();
    canvas.drawPath(tipPath, bubblePaint);
    textPainter.paint(
      canvas,
      Offset(
        bubbleLeft + (bubbleWidth - textPainter.width) / 2,
        bubbleTop + (bubbleHeight - textPainter.height) / 2,
      ),
    );
  }

  void _drawAxisLabel(
    Canvas canvas,
    String text,
    Offset anchor,
    TextAlign align,
  ) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: text,
        style: const TextStyle(
          color: Color(0xFF8D8D8D),
          fontSize: 12,
          height: 17 / 12,
          fontWeight: FontWeight.w500,
        ),
      ),
      textDirection: TextDirection.ltr,
      textAlign: align,
    )..layout();
    final dx = switch (align) {
      TextAlign.center => anchor.dx - textPainter.width / 2,
      TextAlign.right => anchor.dx - textPainter.width,
      _ => anchor.dx,
    };
    textPainter.paint(canvas, Offset(dx, anchor.dy));
  }

  @override
  bool shouldRepaint(covariant FigmaPriceHistoryPainter oldDelegate) {
    return oldDelegate.points != points ||
        oldDelegate.lowPriceText != lowPriceText;
  }
}

class FigmaShippingInfoCard extends StatelessWidget {
  const FigmaShippingInfoCard({required this.detail, super.key});

  final FigmaProductDetailData detail;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(21),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 18,
            offset: const Offset(0, 16),
          ),
        ],
      ),
      child: Column(
        children: [
          FigmaShippingInfoRow(label: '发货地', value: detail.shipFrom),
          const SizedBox(height: 12),
          FigmaShippingInfoRow(
            label: '预计送达时间',
            value: detail.deliveryEstimate,
          ),
        ],
      ),
    );
  }
}

class FigmaShippingInfoRow extends StatelessWidget {
  const FigmaShippingInfoRow({
    required this.label,
    required this.value,
    super.key,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFF5E5E5E),
            fontSize: 13,
            height: 18 / 13,
            fontWeight: FontWeight.w500,
          ),
        ),
        const Spacer(),
        Flexible(
          child: Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.right,
            style: const TextStyle(
              color: Color(0xFF1A1C1C),
              fontSize: 16,
              height: 24 / 16,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }
}

class FigmaServiceGuarantees extends StatelessWidget {
  const FigmaServiceGuarantees({required this.detail, super.key});

  final FigmaProductDetailData detail;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        for (final label in detail.serviceLabels)
          FigmaServiceChip(label: label),
      ],
    );
  }
}

class FigmaServiceChip extends StatelessWidget {
  const FigmaServiceChip({required this.label, super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 11),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 18,
            offset: const Offset(0, 16),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.verified_user_outlined, size: 14),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF5E5E5E),
              fontSize: 12,
              height: 16 / 12,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class FigmaDetailBullet extends StatelessWidget {
  const FigmaDetailBullet({required this.text, super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(
          Icons.check_circle_rounded,
          color: Color(0xFF65D9AA),
          size: 21,
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(
              color: Color(0xFF363636),
              fontSize: 16,
              height: 1.45,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    );
  }
}

class FigmaDetailBottomBar extends StatelessWidget {
  const FigmaDetailBottomBar({
    required this.detail,
    super.key,
  });

  final FigmaProductDetailData detail;

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    return ClipRRect(
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: Container(
          padding: EdgeInsets.fromLTRB(24, 17, 24, 16 + bottomPadding),
          decoration: BoxDecoration(
            color: const Color(0xFFF2F2F2).withValues(alpha: 0.90),
            border: Border(
              top: BorderSide(
                color: const Color(0xFFE6E6E6).withValues(alpha: 0.30),
              ),
            ),
          ),
          child: Row(
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: _SoftCommerceTheme.surface,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.08),
                      blurRadius: 18,
                      offset: const Offset(0, 16),
                    ),
                  ],
                ),
                child: Material(
                  color: Colors.transparent,
                  shape: const CircleBorder(),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: () {},
                    child: const SizedBox(
                      width: 56,
                      height: 56,
                      child: Icon(Icons.favorite_border_rounded, size: 28),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: ProductAppJumpButton(
                  platform: detail.platform,
                  productId: detail.platformProductId,
                  productUrl: detail.productUrl,
                  brandId: detail.platformBrandId,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _detailSubtitle(
    Map<String, dynamic> normalized, DemoCandidate candidate) {
  final shoeType = _firstNonEmpty([
    normalized['shoeType'],
    normalized['category'],
    candidate.material,
  ], fallback: '运动休闲鞋');
  if (shoeType.contains('lifestyle') || shoeType.contains('casual')) {
    return '男子运动休闲鞋';
  }
  if (shoeType.contains('running')) return '男子运动跑鞋';
  if (shoeType.contains('basketball')) return '篮球运动鞋';
  if (shoeType.contains('board') || shoeType.contains('skate')) {
    return '休闲板鞋';
  }
  return shoeType.replaceAll('_', ' ').replaceAll('shoes', '鞋').trim();
}

String _shopTypeLabel(String value) {
  final normalized = value.toLowerCase();
  if (normalized.contains('flagship')) return '旗舰店';
  if (normalized.contains('official')) return '官方';
  if (normalized.contains('tmall')) return '天猫';
  return '商城店';
}

String _firstNonEmpty(List<Object?> values, {String fallback = ''}) {
  for (final value in values) {
    final text = value?.toString().trim();
    if (text != null && text.isNotEmpty && text != 'null') return text;
  }
  return fallback;
}

String? _firstNullableString(List<Object?> values) {
  final value = _firstNonEmpty(values);
  return value.isEmpty ? null : value;
}

Map<String, dynamic> _firstDetailMap(List<Object?> values) {
  for (final value in values) {
    final map = _softMap(value);
    if (map.isNotEmpty) return map;
  }
  return const {};
}

String? _stableNetworkImageUrl(String? value) {
  final trimmed = value?.trim();
  if (trimmed == null || trimmed.isEmpty) return null;
  final uri = Uri.tryParse(trimmed);
  if (uri == null || !uri.hasScheme) return null;
  if (uri.host == 'example.com') return null;
  if (uri.scheme != 'http' && uri.scheme != 'https') return null;
  if (uri.host.endsWith('myqcloud.com') && uri.query.isNotEmpty) {
    return uri.replace(query: '').toString();
  }
  return trimmed;
}

int? _imageCacheWidthFor(BuildContext context, double logicalWidth) {
  if (!logicalWidth.isFinite || logicalWidth <= 0) return null;
  final deviceWidth = logicalWidth * MediaQuery.devicePixelRatioOf(context);
  if (!deviceWidth.isFinite || deviceWidth <= 0) return null;
  return max(1, deviceWidth.round());
}

double? _detailNumber(Object? value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}

List<String> _detailStringList(Object? value) {
  if (value is List) {
    return [
      for (final item in value)
        if (item != null && item.toString().trim().isNotEmpty)
          item.toString().trim(),
    ];
  }
  if (value is String && value.trim().isNotEmpty) return [value.trim()];
  return const [];
}

List<double> _historyPointsFromDetail(
  Map<String, dynamic> priceHistory,
  double amount,
  double matchScore,
) {
  final rawPoints = _jsonList(priceHistory['points']);
  final points = <double>[];
  for (final item in rawPoints) {
    final map = _softMap(item);
    final value = _detailNumber(map['amount'] ?? map['price'] ?? item);
    if (value != null && value > 0) points.add(value);
  }
  if (points.length >= 3) return points;
  return _historyPoints(amount, matchScore);
}

List<double> _historyPoints(double amount, double matchScore) {
  final base = max(amount, 1.0);
  final variance = 0.04 + (1 - matchScore.clamp(0, 1)) * 0.08;
  return [
    base * (1 + variance),
    base * (1 - variance * 0.35),
    base * (1 + variance * 0.75),
    base * (1 + variance * 0.15),
    base,
  ];
}

class SoftConversationPage extends StatefulWidget {
  const SoftConversationPage({
    this.imageFile,
    this.initialPrompt = '',
    this.remoteSessionId,
    this.remoteCandidates,
    this.pendingRemoteSession,
    this.pendingRemoteCandidates,
    super.key,
  });

  final File? imageFile;
  final String initialPrompt;
  final String? remoteSessionId;
  final List<DemoCandidate>? remoteCandidates;
  final Future<RemoteSessionDraft?>? pendingRemoteSession;
  final Future<List<DemoCandidate>?>? pendingRemoteCandidates;

  @override
  State<SoftConversationPage> createState() => _SoftConversationPageState();
}

class _SoftConversationPageState extends State<SoftConversationPage> {
  final _promptController = TextEditingController();
  final _messages = <SoftConversationMessage>[];
  late String _sessionId;
  late List<DemoCandidate> _candidates;
  bool _isListening = false;
  bool _waitingForRemote = false;
  SoftBackendSuggestionDraft? _backendSuggestion;
  MvpFilterSpec _filterSpec = const MvpFilterSpec();
  CandidateSortMode _sortMode = CandidateSortMode.match;

  List<DemoCandidate> get _filteredCandidates {
    final candidates =
        _candidates.where(_filterSpec.matches).toList(growable: false);
    final sorted = candidates.toList();
    switch (_sortMode) {
      case CandidateSortMode.match:
        sorted.sort(compareCandidatesByMatch);
      case CandidateSortMode.price:
        sorted.sort((a, b) => a.amount.compareTo(b.amount));
      case CandidateSortMode.priceHigh:
        sorted.sort((a, b) => b.amount.compareTo(a.amount));
      case CandidateSortMode.rating:
        sorted.sort((a, b) => b.rating.compareTo(a.rating));
      case CandidateSortMode.delivery:
        sorted.sort((a, b) => a.deliveryDays.compareTo(b.deliveryDays));
    }
    return sorted;
  }

  List<String> get _platforms {
    final seen = <String>{};
    return [
      for (final candidate in _candidates)
        if (seen.add(platformDisplayName(candidate.platform)))
          platformDisplayName(candidate.platform),
    ];
  }

  List<DemoCandidate> get _visibleCandidates {
    if (_waitingForRemote && _candidates.isEmpty) return const [];
    return _filteredCandidates;
  }

  @override
  void initState() {
    super.initState();
    _sessionId = widget.remoteSessionId ??
        'LOCAL-${DateTime.now().millisecondsSinceEpoch.toRadixString(36).toUpperCase()}';
    _waitingForRemote = widget.pendingRemoteSession != null ||
        widget.pendingRemoteCandidates != null;
    _candidates = widget.remoteCandidates?.isNotEmpty == true
        ? widget.remoteCandidates!
        : const [];

    final prompt = widget.initialPrompt.trim();
    if (prompt.isNotEmpty) {
      _appendMessage(SoftMessageRole.user, prompt);
      _applyPromptLocally(prompt);
    } else if (widget.imageFile != null) {
      _appendMessage(SoftMessageRole.user, '我上传了一张图片，帮我找相似商品。');
    }
    _appendMessage(
      SoftMessageRole.assistant,
      _waitingForRemote
          ? '正在识别图片和筛选候选商品，先为你准备结果区。'
          : '已为你整理出首批可比价商品，可以继续补充预算、平台或库存要求。',
    );

    if (widget.pendingRemoteSession != null) {
      unawaited(_applyRemoteSession(widget.pendingRemoteSession!));
    }
    if (widget.pendingRemoteCandidates != null) {
      unawaited(_applyRemoteCandidates(widget.pendingRemoteCandidates!));
    }
    if (widget.remoteSessionId != null &&
        !widget.remoteSessionId!.startsWith('LOCAL-')) {
      unawaited(_loadBackendSuggestions());
    }
  }

  @override
  void dispose() {
    _promptController.dispose();
    super.dispose();
  }

  void _appendMessage(SoftMessageRole role, String text) {
    _messages.add(
      SoftConversationMessage(
        role: role,
        text: text,
        createdAt: DateTime.now(),
      ),
    );
  }

  void _applyPromptLocally(String prompt) {
    _filterSpec = _filterSpec.mergePrompt(prompt);
    _sortMode = _sortModeFromPrompt(prompt) ??
        (_filterSpec.cheapestFirst ? CandidateSortMode.price : _sortMode);
  }

  CandidateSortMode? _sortModeFromPrompt(String prompt) {
    if (prompt.contains('好评') ||
        prompt.contains('评分') ||
        prompt.contains('评价')) {
      return CandidateSortMode.rating;
    }
    if (prompt.contains('送达') ||
        prompt.contains('到货') ||
        prompt.contains('最快')) {
      return CandidateSortMode.delivery;
    }
    if (prompt.contains('最低') ||
        prompt.contains('低价') ||
        prompt.contains('便宜') ||
        prompt.contains('价格优先') ||
        prompt.contains('历史低价')) {
      return CandidateSortMode.price;
    }
    if (prompt.contains('高价优先') || prompt.contains('贵的优先')) {
      return CandidateSortMode.priceHigh;
    }
    return null;
  }

  Future<void> _submitMessage([String? quickPrompt]) async {
    final prompt = (quickPrompt ?? _promptController.text).trim();
    if (prompt.isEmpty) return;
    FocusScope.of(context).unfocus();

    Future<RemoteCandidatePage?> remoteTurn;
    if (_sessionId.startsWith('LOCAL-')) {
      remoteTurn = requirementSubmitter.submitInitialRequirement(prompt).then(
            (candidates) => candidates == null
                ? null
                : RemoteCandidatePage(
                    candidates: candidates,
                    nextCursor: null,
                    hasMore: false,
                  ),
          );
    } else {
      remoteTurn = requirementSubmitter.submitSessionTurnPage(
        sessionId: _sessionId,
        text: prompt,
      );
    }

    setState(() {
      _appendMessage(SoftMessageRole.user, prompt);
      _appendMessage(SoftMessageRole.assistant, '我先理解你的问题，正在准备回复。');
      if (_sessionId.startsWith('LOCAL-')) _applyPromptLocally(prompt);
      _promptController.clear();
      _waitingForRemote = backendEnabled;
    });
    unawaited(_applyRemoteTurn(remoteTurn));
  }

  Future<void> _applyRemoteTurn(
    Future<RemoteCandidatePage?> pendingRemote,
  ) async {
    final remote = await pendingRemote;
    if (!mounted) return;
    setState(() {
      _waitingForRemote = false;
      final assistantMessage = remote?.assistantMessage?.trim();
      if (assistantMessage != null && assistantMessage.isNotEmpty) {
        _replaceOrAppendLastConversationAssistantMessage(assistantMessage);
      } else {
        _replaceOrAppendLastConversationAssistantMessage('我已处理这条消息。');
      }
      if (remote != null &&
          remote.stateChangingTurn &&
          remote.candidates.isNotEmpty) {
        _candidates = remote.candidates;
        _appendMessage(
          SoftMessageRole.assistant,
          '已更新结果：当前有 ${_filteredCandidates.length} 个候选，最低价 ${_lowestPriceText(_filteredCandidates)}。',
        );
      }
    });
    unawaited(_loadBackendSuggestions());
  }

  void _replaceOrAppendLastConversationAssistantMessage(String text) {
    if (_messages.isNotEmpty &&
        _messages.last.role == SoftMessageRole.assistant) {
      _messages[_messages.length - 1] = SoftConversationMessage(
        role: SoftMessageRole.assistant,
        text: text,
        createdAt: DateTime.now(),
      );
      return;
    }
    _appendMessage(SoftMessageRole.assistant, text);
  }

  Future<void> _applyRemoteCandidates(
    Future<List<DemoCandidate>?> remoteCandidates,
  ) async {
    final candidates = await remoteCandidates;
    if (!mounted) return;
    setState(() {
      _waitingForRemote = false;
      if (candidates != null && candidates.isNotEmpty) {
        _candidates = candidates;
      }
      _appendMessage(
        SoftMessageRole.assistant,
        '已更新结果：当前有 ${_filteredCandidates.length} 个候选，最低价 ${_lowestPriceText(_filteredCandidates)}。',
      );
    });
    unawaited(_loadBackendSuggestions());
  }

  Future<void> _applyRemoteSession(
    Future<RemoteSessionDraft?> remoteSession,
  ) async {
    final session = await remoteSession;
    if (!mounted) return;
    setState(() {
      _waitingForRemote = false;
      if (session != null && session.candidates.isNotEmpty) {
        _sessionId = session.sessionId;
        _candidates = session.candidates;
      }
      final sessionLabel =
          _sessionId.startsWith('LOCAL-') ? '未连接后端 session' : '已连接后端 session';
      _appendMessage(
        SoftMessageRole.assistant,
        '图片链路已完成：当前会话 $sessionLabel，共 ${_filteredCandidates.length} 个候选。',
      );
    });
    unawaited(_loadBackendSuggestions());
  }

  Future<void> _loadBackendSuggestions() async {
    if (_sessionId.startsWith('LOCAL-')) return;
    final suggestions = await requirementSubmitter.fetchSessionSuggestions(
      _sessionId,
    );
    if (!mounted || suggestions == null) return;
    setState(() => _backendSuggestion = suggestions);
  }

  Future<void> _startVoiceInput() async {
    if (_isListening) return;
    setState(() => _isListening = true);
    try {
      await voiceChannel.invokeMethod<bool>('ensurePermission');
      final spokenText = await voiceChannel.invokeMethod<String>('listen');
      if (!mounted) return;
      final text = spokenText?.trim();
      if (text == null || text.isEmpty) {
        _showMessage('没有听到内容，可以直接输入。');
        return;
      }
      await _submitMessage(text);
    } on PlatformException catch (error) {
      if (mounted) _showMessage(error.message ?? '暂时无法使用语音输入。');
    } on MissingPluginException {
      if (mounted) _showMessage('当前平台暂不支持语音输入，可以先手动输入。');
    } finally {
      if (mounted) setState(() => _isListening = false);
    }
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 2),
        ),
      );
  }

  void _openCandidate(DemoCandidate candidate) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => SoftCandidateDetailSheet(
        candidate: candidate,
        sessionId: _sessionId,
        pendingDetail: requirementSubmitter
            .fetchCandidateDetail(candidate.candidateItemId),
        onPay: () => _openPaymentSheet(candidate),
        onSubmitMessage: _submitMessage,
      ),
    );
  }

  void _openPaymentSheet(DemoCandidate candidate) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => PaymentActionSheet(candidate: candidate),
    );
  }

  void _clearPlatform() {
    setState(() {
      _filterSpec = _filterSpec.withPlatform(null);
    });
  }

  void _selectPlatform(String platform) {
    setState(() {
      _filterSpec = _filterSpec.withPlatform(platform);
    });
  }

  @override
  Widget build(BuildContext context) {
    final candidates = _visibleCandidates;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Scaffold(
      backgroundColor: _SoftCommerceTheme.canvas,
      body: SafeArea(
        child: Column(
          children: [
            SoftConversationHeader(
              sessionId: _sessionId,
              onBack: () => Navigator.of(context).pop(),
            ),
            Expanded(
              child: ListView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                padding: const EdgeInsets.fromLTRB(24, 10, 24, 28),
                children: [
                  for (final message in _messages) ...[
                    SoftMessageBubble(message: message),
                    const SizedBox(height: 10),
                  ],
                  if (widget.imageFile != null) ...[
                    const SizedBox(height: 8),
                    SoftImageContextCard(imageFile: widget.imageFile!),
                    const SizedBox(height: 18),
                  ],
                  SoftResultSummaryCard(
                    isLoading: _waitingForRemote,
                    candidates: candidates,
                    sessionId: _sessionId,
                    onQuickPrompt: _submitMessage,
                  ),
                  const SizedBox(height: 18),
                  SoftPlatformChips(
                    platforms: _platforms,
                    activePlatform: _filterSpec.platform == null
                        ? null
                        : platformDisplayName(_filterSpec.platform!),
                    onClear: _clearPlatform,
                    onSelected: _selectPlatform,
                  ),
                  const SizedBox(height: 18),
                  SoftRecommendationRail(onSelected: _submitMessage),
                  if (_backendSuggestion != null) ...[
                    const SizedBox(height: 14),
                    SoftBackendSuggestionPanel(
                      draft: _backendSuggestion!,
                      onSelected: _submitMessage,
                    ),
                  ],
                  const SizedBox(height: 20),
                  if (_waitingForRemote && candidates.isEmpty)
                    const SoftSkeletonResultList()
                  else if (candidates.isEmpty)
                    SoftEmptyResults(onLoosen: () => _submitMessage('放宽到600以内'))
                  else
                    SoftProductGrid(
                      candidates: candidates,
                      onOpen: _openCandidate,
                    ),
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(
                16,
                6,
                16,
                max(12, bottomInset > 0 ? 12 : 18),
              ),
              child: SoftPromptDock(
                controller: _promptController,
                hintText: '继续补充预算、平台或偏好',
                onSubmit: _submitMessage,
                onVoicePressed: _startVoiceInput,
                isListening: _isListening,
                compact: true,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class SoftTopBar extends StatelessWidget {
  const SoftTopBar({
    required this.title,
    required this.cityLabel,
    required this.isLocating,
    required this.onMenuPressed,
    required this.onLocationPressed,
    super.key,
  });

  final String title;
  final String cityLabel;
  final bool isLocating;
  final VoidCallback onMenuPressed;
  final VoidCallback onLocationPressed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 12, 18, 8),
      child: Row(
        children: [
          SoftIconButton(icon: Icons.menu_rounded, onPressed: onMenuPressed),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: _SoftCommerceTheme.ink,
                fontSize: 20,
                height: 1.1,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          SoftLocationButton(
            cityLabel: cityLabel,
            isLocating: isLocating,
            onPressed: onLocationPressed,
          ),
        ],
      ),
    );
  }
}

class SoftHeroPanel extends StatelessWidget {
  const SoftHeroPanel({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 74,
          height: 74,
          decoration: BoxDecoration(
            color: _SoftCommerceTheme.surface,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [_SoftCommerceTheme.shadow],
          ),
          child: const Icon(
            Icons.saved_search_rounded,
            color: _SoftCommerceTheme.ink,
            size: 34,
          ),
        ),
        const SizedBox(height: 24),
        const Text(
          '拍图、描述需求，\n生成可比较的商品候选。',
          style: TextStyle(
            color: _SoftCommerceTheme.ink,
            fontSize: 32,
            height: 1.15,
            fontWeight: FontWeight.w900,
            letterSpacing: 0,
          ),
        ),
        const SizedBox(height: 14),
        const Text(
          '输入预算、平台、库存和偏好，助手会把候选商品收拢到同一轮对话里。',
          style: TextStyle(
            color: _SoftCommerceTheme.muted,
            fontSize: 15,
            height: 1.55,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class SoftPromptDock extends StatelessWidget {
  const SoftPromptDock({
    required this.controller,
    required this.hintText,
    required this.onSubmit,
    this.focusNode,
    this.onImagePressed,
    this.onVoicePressed,
    this.isListening = false,
    this.isWorking = false,
    this.compact = false,
    super.key,
  });

  final TextEditingController controller;
  final FocusNode? focusNode;
  final String hintText;
  final VoidCallback onSubmit;
  final VoidCallback? onImagePressed;
  final VoidCallback? onVoicePressed;
  final bool isListening;
  final bool isWorking;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.all(compact ? 8 : 10),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(compact ? 28 : 32),
        boxShadow: [_SoftCommerceTheme.shadow],
      ),
      child: Row(
        children: [
          if (onImagePressed != null) ...[
            SoftIconButton(
              icon: isWorking
                  ? Icons.hourglass_top_rounded
                  : Icons.add_photo_alternate_rounded,
              onPressed: onImagePressed!,
              flat: true,
            ),
            const SizedBox(width: 6),
          ],
          Expanded(
            child: TextField(
              controller: controller,
              focusNode: focusNode,
              minLines: 1,
              maxLines: compact ? 2 : 3,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => onSubmit(),
              decoration: InputDecoration(
                hintText: hintText,
                hintStyle: const TextStyle(
                  color: _SoftCommerceTheme.faint,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
                border: InputBorder.none,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 12,
                ),
              ),
              style: const TextStyle(
                color: _SoftCommerceTheme.ink,
                fontSize: 15,
                fontWeight: FontWeight.w700,
                height: 1.3,
              ),
            ),
          ),
          if (onVoicePressed != null) ...[
            const SizedBox(width: 6),
            SoftIconButton(
              icon: isListening ? Icons.graphic_eq_rounded : Icons.mic_rounded,
              onPressed: onVoicePressed!,
              flat: true,
            ),
          ],
          const SizedBox(width: 6),
          SoftIconButton(
            icon: Icons.arrow_upward_rounded,
            onPressed: onSubmit,
            strong: true,
          ),
        ],
      ),
    );
  }
}

class SoftIconButton extends StatelessWidget {
  const SoftIconButton({
    required this.icon,
    required this.onPressed,
    this.strong = false,
    this.flat = false,
    this.size = 44,
    super.key,
  });

  final IconData icon;
  final VoidCallback onPressed;
  final bool strong;
  final bool flat;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: strong
          ? _SoftCommerceTheme.ink
          : flat
              ? _SoftCommerceTheme.recessed
              : _SoftCommerceTheme.surface,
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onPressed,
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            boxShadow: strong
                ? [_SoftCommerceTheme.buttonShadow]
                : flat
                    ? null
                    : [_SoftCommerceTheme.tightShadow],
          ),
          child: Icon(
            icon,
            color: strong ? _SoftCommerceTheme.surface : _SoftCommerceTheme.ink,
            size: size * 0.48,
          ),
        ),
      ),
    );
  }
}

class SoftLocationButton extends StatelessWidget {
  const SoftLocationButton({
    required this.cityLabel,
    required this.isLocating,
    required this.onPressed,
    super.key,
  });

  final String cityLabel;
  final bool isLocating;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _SoftCommerceTheme.surface,
      borderRadius: BorderRadius.circular(999),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (isLocating)
                const SizedBox(
                  width: 15,
                  height: 15,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: _SoftCommerceTheme.ink,
                  ),
                )
              else
                const Icon(
                  Icons.location_on_rounded,
                  color: _SoftCommerceTheme.ink,
                  size: 16,
                ),
              const SizedBox(width: 5),
              Text(
                cityLabel,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: _SoftCommerceTheme.ink,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SoftQuickStartRow extends StatelessWidget {
  const SoftQuickStartRow({
    required this.prompts,
    required this.onSelected,
    super.key,
  });

  final List<String> prompts;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        for (final prompt in prompts)
          SoftRaisedChip(
            label: prompt,
            onTap: () => onSelected(prompt),
          ),
      ],
    );
  }
}

class SoftRaisedChip extends StatelessWidget {
  const SoftRaisedChip({
    required this.label,
    this.onTap,
    this.active = false,
    this.icon,
    super.key,
  });

  final String label;
  final VoidCallback? onTap;
  final bool active;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? _SoftCommerceTheme.ink : _SoftCommerceTheme.surface,
      borderRadius: BorderRadius.circular(999),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border:
                active ? null : Border.all(color: _SoftCommerceTheme.border),
            boxShadow: active ? null : [_SoftCommerceTheme.tightShadow],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(
                  icon,
                  size: 15,
                  color: active
                      ? _SoftCommerceTheme.surface
                      : _SoftCommerceTheme.ink,
                ),
                const SizedBox(width: 6),
              ],
              Text(
                label,
                style: TextStyle(
                  color: active
                      ? _SoftCommerceTheme.surface
                      : _SoftCommerceTheme.ink,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SoftHistoryDrawer extends StatelessWidget {
  const SoftHistoryDrawer({
    required this.threads,
    required this.activeThreadId,
    required this.onNewChat,
    required this.onSelectThread,
    required this.onOpenUserProfile,
    super.key,
  });

  final List<SoftConversationThread> threads;
  final String? activeThreadId;
  final VoidCallback onNewChat;
  final ValueChanged<SoftConversationThread> onSelectThread;
  final VoidCallback onOpenUserProfile;

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    return Drawer(
      width: min(MediaQuery.sizeOf(context).width * 0.86, 340),
      backgroundColor: const Color(0xFFFAFAF8),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.horizontal(right: Radius.circular(24)),
      ),
      child: SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(20, 18, 20, 14 + bottomPadding),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const SoftBrandMark(size: 38),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'SoleAI',
                          style: TextStyle(
                            color: _SoftCommerceTheme.ink,
                            fontSize: 20,
                            height: 24 / 20,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          '购物对话',
                          style: TextStyle(
                            color: Color(0xFF7D7D78),
                            fontSize: 11,
                            height: 15 / 11,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Material(
                    color: _SoftCommerceTheme.surface,
                    shape: const CircleBorder(),
                    clipBehavior: Clip.antiAlias,
                    child: InkWell(
                      customBorder: const CircleBorder(),
                      onTap: () => Navigator.of(context).maybePop(),
                      child: const SizedBox(
                        width: 36,
                        height: 36,
                        child: Icon(
                          Icons.close_rounded,
                          size: 22,
                          color: Color(0xFF555555),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 22),
              Material(
                color: _SoftCommerceTheme.surface,
                borderRadius: BorderRadius.circular(14),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: onNewChat,
                  child: Container(
                    height: 50,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFE3E3DF)),
                    ),
                    child: const Row(
                      children: [
                        SizedBox(
                          width: 28,
                          height: 28,
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: _SoftCommerceTheme.ink,
                              shape: BoxShape.circle,
                            ),
                            child: Icon(
                              Icons.add_rounded,
                              color: _SoftCommerceTheme.surface,
                              size: 19,
                            ),
                          ),
                        ),
                        SizedBox(width: 11),
                        Text(
                          '开始新对话',
                          style: TextStyle(
                            color: _SoftCommerceTheme.ink,
                            fontSize: 14,
                            height: 18 / 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Spacer(),
                        Icon(
                          Icons.arrow_forward_rounded,
                          color: Color(0xFF8D8D88),
                          size: 18,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                '最近对话',
                style: TextStyle(
                  color: Color(0xFF8C8C87),
                  fontSize: 12,
                  height: 16 / 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 10),
              Expanded(
                child: ListView(
                  padding: EdgeInsets.zero,
                  children: _buildHistoryRows(),
                ),
              ),
              Container(
                padding: const EdgeInsets.fromLTRB(0, 14, 0, 0),
                decoration: const BoxDecoration(
                  border: Border(
                    top: BorderSide(color: Color(0xFFE6E6E2)),
                  ),
                ),
                child: SoftDrawerProfileEntry(
                  onTap: onOpenUserProfile,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _buildHistoryRows() {
    if (threads.isEmpty) {
      return const [
        SoftHistoryEmptyState(),
      ];
    }

    final rows = <Widget>[];
    final recent = threads.take(4).toList(growable: false);
    final older = threads.skip(4).toList(growable: false);
    for (final thread in recent) {
      rows.add(_threadRow(thread));
    }
    if (older.isNotEmpty) {
      rows.add(
        const Padding(
          padding: EdgeInsets.fromLTRB(4, 14, 4, 16),
          child: Divider(
            height: 1,
            thickness: 1,
            color: Color(0xFFE6E6E2),
          ),
        ),
      );
      rows.add(
        const Padding(
          padding: EdgeInsets.only(left: 4, bottom: 9),
          child: Text(
            '较早之前',
            style: TextStyle(
              color: Color(0xFF8C8C87),
              fontSize: 12,
              height: 16 / 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      );
      for (final thread in older) {
        rows.add(_threadRow(thread));
      }
    }
    return rows;
  }

  Widget _threadRow(SoftConversationThread thread) {
    final selected = thread.id == activeThreadId;
    return SoftHistoryRow(
      title: thread.title,
      meta: _threadMeta(thread),
      icon:
          selected ? Icons.chat_bubble_outline_rounded : Icons.history_rounded,
      selected: selected,
      onTap: () => onSelectThread(thread),
    );
  }

  String _threadMeta(SoftConversationThread thread) {
    final time = _relativeTime(thread.updatedAt);
    if (thread.candidateCount > 0) {
      return '${thread.candidateCount} 件候选 · $time';
    }
    if (thread.remoteSessionId != null &&
        !thread.remoteSessionId!.startsWith('LOCAL-')) {
      return '云端会话 · $time';
    }
    return time;
  }

  String _relativeTime(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inMinutes < 1) return '刚刚';
    if (diff.inHours < 1) return '${diff.inMinutes} 分钟前';
    if (diff.inDays < 1) return '${diff.inHours} 小时前';
    return '${diff.inDays} 天前';
  }
}

class SoftDrawerProfileEntry extends StatelessWidget {
  const SoftDrawerProfileEntry({required this.onTap, super.key});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: const Padding(
          padding: EdgeInsets.symmetric(horizontal: 6, vertical: 8),
          child: Row(
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: _SoftCommerceTheme.ink,
                    foregroundColor: _SoftCommerceTheme.surface,
                    child: Icon(Icons.person_rounded, size: 18),
                  ),
                  Positioned(
                    right: -2,
                    bottom: -2,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: _SoftCommerceTheme.surface,
                        shape: BoxShape.circle,
                      ),
                      child: Padding(
                        padding: EdgeInsets.all(2),
                        child: Icon(
                          Icons.edit_rounded,
                          color: _SoftCommerceTheme.ink,
                          size: 11,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'User_8921',
                      style: TextStyle(
                        color: _SoftCommerceTheme.ink,
                        fontSize: 13,
                        height: 17 / 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      '用户画像',
                      style: TextStyle(
                        color: Color(0xFFA0A0A0),
                        fontSize: 10,
                        height: 14 / 10,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right_rounded,
                color: Color(0xFF969691),
                size: 22,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SoftHistoryEmptyState extends StatelessWidget {
  const SoftHistoryEmptyState({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 18),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F7F7),
        borderRadius: BorderRadius.circular(12),
      ),
      child: const Text(
        '暂无历史对话。发送第一条需求后，这里会自动保存。',
        style: TextStyle(
          color: Color(0xFF8A8A8A),
          fontSize: 14,
          height: 20 / 14,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

class SoftBrandMark extends StatelessWidget {
  const SoftBrandMark({required this.size, super.key});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: _SoftCommerceTheme.ink,
        shape: BoxShape.circle,
      ),
      child: Text(
        'S',
        style: TextStyle(
          color: _SoftCommerceTheme.surface,
          fontSize: size * 0.44,
          height: 1,
          fontWeight: FontWeight.w800,
          letterSpacing: 0,
        ),
      ),
    );
  }
}

class SoftHistoryRow extends StatelessWidget {
  const SoftHistoryRow({
    required this.title,
    this.meta,
    this.icon = Icons.history_rounded,
    this.selected = false,
    this.onTap,
    super.key,
  });

  final String title;
  final String? meta;
  final IconData icon;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            decoration: BoxDecoration(
              color: selected ? _SoftCommerceTheme.surface : Colors.transparent,
              borderRadius: BorderRadius.circular(12),
              border:
                  selected ? Border.all(color: const Color(0xFFE2E2DE)) : null,
            ),
            child: Row(
              children: [
                Container(
                  width: 30,
                  height: 30,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: selected
                        ? _SoftCommerceTheme.ink
                        : const Color(0xFFEDEDEA),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    icon,
                    size: 15,
                    color: selected
                        ? _SoftCommerceTheme.surface
                        : const Color(0xFF777773),
                  ),
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: selected
                              ? _SoftCommerceTheme.ink
                              : const Color(0xFF555555),
                          fontSize: 13,
                          height: 18 / 13,
                          fontWeight:
                              selected ? FontWeight.w700 : FontWeight.w500,
                        ),
                      ),
                      if (meta != null) ...[
                        const SizedBox(height: 3),
                        Text(
                          meta!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Color(0xFFA0A0A0),
                            fontSize: 10,
                            height: 14 / 10,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class SoftConversationHeader extends StatelessWidget {
  const SoftConversationHeader({
    required this.sessionId,
    required this.onBack,
    super.key,
  });

  final String sessionId;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 12, 18, 8),
      child: Row(
        children: [
          SoftIconButton(icon: Icons.arrow_back_rounded, onPressed: onBack),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '智能匹配结果',
                  style: TextStyle(
                    color: _SoftCommerceTheme.ink,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  sessionId.startsWith('LOCAL-')
                      ? '本地兜底链路'
                      : '后端 session: $sessionId',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: _SoftCommerceTheme.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          SoftIconButton(
            icon: Icons.more_horiz_rounded,
            onPressed: () {},
            flat: true,
          ),
        ],
      ),
    );
  }
}

class SoftMessageBubble extends StatelessWidget {
  const SoftMessageBubble({required this.message, super.key});

  final SoftConversationMessage message;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == SoftMessageRole.user;
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.74,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
        decoration: BoxDecoration(
          color: isUser ? _SoftCommerceTheme.surface : _SoftCommerceTheme.ink,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(24),
            topRight: const Radius.circular(24),
            bottomLeft: Radius.circular(isUser ? 24 : 8),
            bottomRight: Radius.circular(isUser ? 8 : 24),
          ),
          boxShadow: [_SoftCommerceTheme.tightShadow],
        ),
        child: Text(
          message.text,
          style: TextStyle(
            color: isUser ? _SoftCommerceTheme.ink : _SoftCommerceTheme.surface,
            fontSize: 14,
            height: 1.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class SoftImageContextCard extends StatelessWidget {
  const SoftImageContextCard({required this.imageFile, super.key});

  final File imageFile;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(34),
        boxShadow: [_SoftCommerceTheme.shadow],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(34)),
            child: AspectRatio(
              aspectRatio: 1.35,
              child: Image.file(imageFile, fit: BoxFit.cover),
            ),
          ),
          const Padding(
            padding: EdgeInsets.fromLTRB(18, 14, 18, 18),
            child: Row(
              children: [
                Icon(Icons.center_focus_strong_rounded, size: 18),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '已复用现有裁剪与压缩链路，当前图片会作为识别主图上传。',
                    style: TextStyle(
                      color: _SoftCommerceTheme.muted,
                      fontSize: 12,
                      height: 1.4,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class SoftResultSummaryCard extends StatelessWidget {
  const SoftResultSummaryCard({
    required this.isLoading,
    required this.candidates,
    required this.sessionId,
    required this.onQuickPrompt,
    super.key,
  });

  final bool isLoading;
  final List<DemoCandidate> candidates;
  final String sessionId;
  final ValueChanged<String> onQuickPrompt;

  @override
  Widget build(BuildContext context) {
    final best = candidates.isEmpty ? null : candidates.first;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(34),
        boxShadow: [_SoftCommerceTheme.shadow],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  isLoading ? '正在为您筛选' : '已为您找到 ${candidates.length} 个候选商品',
                  style: const TextStyle(
                    color: _SoftCommerceTheme.ink,
                    fontSize: 24,
                    height: 1.18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Container(
                width: 54,
                height: 54,
                decoration: const BoxDecoration(
                  color: _SoftCommerceTheme.ink,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  isLoading ? Icons.sync_rounded : Icons.auto_awesome_rounded,
                  color: _SoftCommerceTheme.surface,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            best == null
                ? '后端返回前会显示骨架屏；如果接口不可用，会自动使用本地演示商品。'
                : '当前优先推荐 ${best.title}，最低价 ${_lowestPriceText(candidates)}，可继续用一句话收窄条件。',
            style: const TextStyle(
              color: _SoftCommerceTheme.muted,
              fontSize: 14,
              height: 1.5,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              SoftRaisedChip(
                icon: Icons.inventory_2_rounded,
                label: '只看有货',
                onTap: () => onQuickPrompt('只看有货'),
              ),
              SoftRaisedChip(
                icon: Icons.currency_yen_rounded,
                label: '500以内',
                onTap: () => onQuickPrompt('500以内'),
              ),
              SoftRaisedChip(
                icon: Icons.south_rounded,
                label: '最低价优先',
                onTap: () => onQuickPrompt('先看最低价'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class SoftPlatformChips extends StatelessWidget {
  const SoftPlatformChips({
    required this.platforms,
    required this.activePlatform,
    required this.onClear,
    required this.onSelected,
    super.key,
  });

  final List<String> platforms;
  final String? activePlatform;
  final VoidCallback onClear;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    if (platforms.isEmpty) return const SizedBox.shrink();
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          SoftRaisedChip(
            label: '全部平台',
            active: activePlatform == null,
            onTap: onClear,
          ),
          const SizedBox(width: 10),
          for (final platform in platforms) ...[
            SoftRaisedChip(
              label: platform,
              active: activePlatform == platform,
              onTap: () => onSelected(platform),
            ),
            const SizedBox(width: 10),
          ],
        ],
      ),
    );
  }
}

class SoftRecommendationRail extends StatelessWidget {
  const SoftRecommendationRail({required this.onSelected, super.key});

  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    const items = [
      ('同款排除', '去掉标题相似但不是同款的候选', Icons.filter_alt_rounded, '排除非同款，只保留高度相似'),
      ('只看有货', '减少无效候选商品', Icons.inventory_2_rounded, '只看有货'),
      ('500以内', '按预算继续收敛', Icons.currency_yen_rounded, '500以内'),
    ];
    return SizedBox(
      height: 132,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          final item = items[index];
          return Material(
            color: _SoftCommerceTheme.surface,
            borderRadius: BorderRadius.circular(30),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              borderRadius: BorderRadius.circular(30),
              onTap: () => onSelected(item.$4),
              child: Container(
                width: 188,
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(30),
                  boxShadow: [_SoftCommerceTheme.shadow],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(item.$3, color: _SoftCommerceTheme.ink, size: 24),
                    const Spacer(),
                    Text(
                      item.$1,
                      style: const TextStyle(
                        color: _SoftCommerceTheme.ink,
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      item.$2,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: _SoftCommerceTheme.muted,
                        fontSize: 12,
                        height: 1.35,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class SoftBackendSuggestionPanel extends StatelessWidget {
  const SoftBackendSuggestionPanel({
    required this.draft,
    required this.onSelected,
    super.key,
  });

  final SoftBackendSuggestionDraft draft;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final turnActions = draft.actions
        .where((action) => action.isSubmitTurn)
        .toList(growable: false);
    if (draft.conclusion.isEmpty && turnActions.isEmpty) {
      return const SizedBox.shrink();
    }
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(30),
        boxShadow: [_SoftCommerceTheme.shadow],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.tips_and_updates_rounded, size: 20),
              SizedBox(width: 8),
              Text(
                '后端建议',
                style: TextStyle(
                  color: _SoftCommerceTheme.ink,
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          if (draft.conclusion.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              draft.conclusion,
              style: const TextStyle(
                color: _SoftCommerceTheme.muted,
                fontSize: 13,
                height: 1.45,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
          if (turnActions.isNotEmpty) ...[
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final action in turnActions)
                  SoftRaisedChip(
                    label: action.title,
                    icon: Icons.arrow_forward_rounded,
                    onTap: () => onSelected(action.prompt),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class SoftProductGrid extends StatelessWidget {
  const SoftProductGrid({
    required this.candidates,
    required this.onOpen,
    super.key,
  });

  final List<DemoCandidate> candidates;
  final ValueChanged<DemoCandidate> onOpen;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const gutter = 14.0;
        final columnWidth = (constraints.maxWidth - gutter) / 2;
        return Wrap(
          spacing: gutter,
          runSpacing: 16,
          children: [
            for (final candidate in candidates)
              SizedBox(
                width: columnWidth,
                child: SoftProductCard(
                  candidate: candidate,
                  onOpen: () => onOpen(candidate),
                ),
              ),
          ],
        );
      },
    );
  }
}

class SoftProductCard extends StatelessWidget {
  const SoftProductCard({
    required this.candidate,
    required this.onOpen,
    super.key,
  });

  final DemoCandidate candidate;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _SoftCommerceTheme.surface,
      borderRadius: BorderRadius.circular(32),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        borderRadius: BorderRadius.circular(32),
        onTap: onOpen,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(32),
            boxShadow: [_SoftCommerceTheme.shadow],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                children: [
                  AspectRatio(
                    aspectRatio: 1,
                    child: Container(
                      color: _SoftCommerceTheme.recessed,
                      child: ProductThumbnail(
                        imageUrl: candidate.imageUrl,
                        accentColor: candidate.accentColor,
                        iconSize: 54,
                      ),
                    ),
                  ),
                  Positioned(
                    left: 10,
                    top: 10,
                    child: SoftMiniStatusChip(
                      text: '${(candidate.matchScore * 100).round()}% Match',
                      color: _SoftCommerceTheme.ink,
                    ),
                  ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 13, 14, 15),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      candidate.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: _SoftCommerceTheme.ink,
                        fontSize: 14,
                        height: 1.25,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      platformDisplayName(candidate.platform),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: _SoftCommerceTheme.muted,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 11),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Expanded(
                          child: Text(
                            '¥${candidate.amount.toStringAsFixed(0)}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: _SoftCommerceTheme.ink,
                              fontSize: 20,
                              height: 1,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        SoftStockDot(status: candidate.stockStatus),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SoftMiniStatusChip extends StatelessWidget {
  const SoftMiniStatusChip(
      {required this.text, required this.color, super.key});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: const TextStyle(
          color: _SoftCommerceTheme.surface,
          fontSize: 10,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class SoftStockDot extends StatelessWidget {
  const SoftStockDot({required this.status, super.key});

  final StockStatus status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      StockStatus.inStock => _SoftCommerceTheme.stock,
      StockStatus.unknown => _SoftCommerceTheme.warning,
      StockStatus.outOfStock => _SoftCommerceTheme.danger,
    };
    final label = switch (status) {
      StockStatus.inStock => '有货',
      StockStatus.unknown => '未知',
      StockStatus.outOfStock => '无货',
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: const TextStyle(
            color: _SoftCommerceTheme.muted,
            fontSize: 10,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

class SoftCandidateDetailSheet extends StatefulWidget {
  const SoftCandidateDetailSheet({
    required this.candidate,
    required this.sessionId,
    required this.pendingDetail,
    required this.onPay,
    required this.onSubmitMessage,
    super.key,
  });

  final DemoCandidate candidate;
  final String sessionId;
  final Future<Map<String, dynamic>?>? pendingDetail;
  final VoidCallback onPay;
  final ValueChanged<String> onSubmitMessage;

  @override
  State<SoftCandidateDetailSheet> createState() =>
      _SoftCandidateDetailSheetState();
}

class _SoftCandidateDetailSheetState extends State<SoftCandidateDetailSheet> {
  final _controller = TextEditingController();
  Map<String, dynamic>? _detail;
  bool _detailLoading = false;

  @override
  void initState() {
    super.initState();
    unawaited(_loadDetail());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _loadDetail() async {
    final pending = widget.pendingDetail;
    if (pending == null) return;
    setState(() => _detailLoading = true);
    final detail = await pending;
    if (!mounted) return;
    setState(() {
      _detail = detail;
      _detailLoading = false;
    });
  }

  void _submit() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    widget.onSubmitMessage(text);
    Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final candidate = widget.candidate;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(top: 28, bottom: bottomInset),
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(38)),
        child: Material(
          color: _SoftCommerceTheme.canvas,
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(24, 14, 24, 18),
                    children: [
                      Center(
                        child: Container(
                          width: 42,
                          height: 4,
                          decoration: BoxDecoration(
                            color: const Color(0xFFD4D4D4),
                            borderRadius: BorderRadius.circular(999),
                          ),
                        ),
                      ),
                      const SizedBox(height: 18),
                      Row(
                        children: [
                          SoftIconButton(
                            icon: Icons.arrow_back_rounded,
                            onPressed: () => Navigator.of(context).maybePop(),
                            flat: true,
                          ),
                          const Spacer(),
                          SoftIconButton(
                            icon: Icons.grid_view_rounded,
                            onPressed: () {},
                            flat: true,
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Container(
                        decoration: BoxDecoration(
                          color: _SoftCommerceTheme.surface,
                          borderRadius: BorderRadius.circular(36),
                          boxShadow: [_SoftCommerceTheme.shadow],
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(36),
                          child: AspectRatio(
                            aspectRatio: 1.12,
                            child: Container(
                              color: _SoftCommerceTheme.recessed,
                              child: ProductThumbnail(
                                imageUrl: candidate.imageUrl,
                                accentColor: candidate.accentColor,
                                iconSize: 110,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 18),
                      Row(
                        children: [
                          SoftMetricPill(
                            icon: Icons.verified_rounded,
                            label:
                                '${(candidate.matchScore * 100).round()}% 匹配',
                          ),
                          const SizedBox(width: 10),
                          SoftMetricPill(
                            icon: Icons.star_rounded,
                            label:
                                '${candidate.rating.toStringAsFixed(1)} 店铺评分',
                          ),
                          const SizedBox(width: 10),
                          SoftMetricPill(
                            icon: Icons.local_shipping_rounded,
                            label: candidate.deliveryLabel,
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: _SoftCommerceTheme.surface,
                          borderRadius: BorderRadius.circular(34),
                          boxShadow: [_SoftCommerceTheme.shadow],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Text(
                                    candidate.title,
                                    style: const TextStyle(
                                      color: _SoftCommerceTheme.ink,
                                      fontSize: 24,
                                      height: 1.18,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Text(
                                  '¥${candidate.amount.toStringAsFixed(0)}',
                                  style: const TextStyle(
                                    color: _SoftCommerceTheme.ink,
                                    fontSize: 30,
                                    height: 1,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            Text(
                              '${platformDisplayName(candidate.platform)} · ${_detailShopName(_detail) ?? candidate.shopName ?? '候选店铺'} · ${candidate.material}',
                              style: const TextStyle(
                                color: _SoftCommerceTheme.muted,
                                fontSize: 13,
                                height: 1.45,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 16),
                            if (_detailLoading) ...[
                              const SoftBullet(text: '正在同步后端详情、店铺和配送信息。'),
                              const SizedBox(height: 9),
                            ],
                            if (!_detailLoading && _detail != null) ...[
                              SoftBullet(
                                text: _detailDecisionText(_detail!) ??
                                    '后端详情已同步，当前商品可以继续追问或进入比价。',
                              ),
                              const SizedBox(height: 9),
                              if (_detailDeliveryText(_detail!) != null) ...[
                                SoftBullet(
                                    text: _detailDeliveryText(_detail!)!),
                                const SizedBox(height: 9),
                              ],
                            ],
                            for (final bullet
                                in candidate.detailBullets.take(3)) ...[
                              SoftBullet(text: bullet),
                              const SizedBox(height: 9),
                            ],
                            const SizedBox(height: 6),
                            SoftPrimaryButton(
                              label: '去比价 / 查看购买入口',
                              icon: Icons.shopping_bag_rounded,
                              onPressed: widget.onPay,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 14),
                  child: SoftPromptDock(
                    controller: _controller,
                    hintText: '继续追问这件商品',
                    onSubmit: _submit,
                    compact: true,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class SoftMetricPill extends StatelessWidget {
  const SoftMetricPill({
    required this.icon,
    required this.label,
    super.key,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        constraints: const BoxConstraints(minHeight: 72),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
        decoration: BoxDecoration(
          color: _SoftCommerceTheme.surface,
          borderRadius: BorderRadius.circular(24),
          boxShadow: [_SoftCommerceTheme.tightShadow],
        ),
        child: Column(
          children: [
            Icon(icon, color: _SoftCommerceTheme.ink, size: 22),
            const SizedBox(height: 7),
            Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: _SoftCommerceTheme.muted,
                fontSize: 11,
                height: 1.2,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class SoftBullet extends StatelessWidget {
  const SoftBullet({required this.text, super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          margin: const EdgeInsets.only(top: 7),
          width: 6,
          height: 6,
          decoration: const BoxDecoration(
            color: _SoftCommerceTheme.ink,
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(
              color: _SoftCommerceTheme.muted,
              fontSize: 13,
              height: 1.45,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }
}

class SoftPrimaryButton extends StatelessWidget {
  const SoftPrimaryButton({
    required this.label,
    required this.icon,
    required this.onPressed,
    super.key,
  });

  final String label;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _SoftCommerceTheme.ink,
      borderRadius: BorderRadius.circular(999),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onPressed,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            boxShadow: [_SoftCommerceTheme.buttonShadow],
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: _SoftCommerceTheme.surface, size: 18),
              const SizedBox(width: 8),
              Text(
                label,
                style: const TextStyle(
                  color: _SoftCommerceTheme.surface,
                  fontSize: 14,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SoftImageSourceSheet extends StatelessWidget {
  const SoftImageSourceSheet({super.key});

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    return ClipRRect(
      borderRadius: const BorderRadius.vertical(top: Radius.circular(36)),
      child: Material(
        color: _SoftCommerceTheme.canvas,
        child: Padding(
          padding: EdgeInsets.fromLTRB(24, 14, 24, 20 + bottomPadding),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 42,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFD4D4D4),
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              const Text(
                '选择图片来源',
                style: TextStyle(
                  color: _SoftCommerceTheme.ink,
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                '拍一张参考图，或从相册选择已有商品图。',
                style: TextStyle(
                  color: _SoftCommerceTheme.muted,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 18),
              SoftImageSourceRow(
                icon: Icons.photo_camera_rounded,
                title: '拍摄照片',
                subtitle: '调用手机摄像头，拍完后进入框选和压缩',
                onTap: () => Navigator.of(context).pop(ImageSource.camera),
              ),
              const SizedBox(height: 12),
              SoftImageSourceRow(
                icon: Icons.photo_library_rounded,
                title: '上传本地图片',
                subtitle: '从相册选择，再复用现有识别图片处理链路',
                onTap: () => Navigator.of(context).pop(ImageSource.gallery),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SoftImageSourceRow extends StatelessWidget {
  const SoftImageSourceRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _SoftCommerceTheme.surface,
      borderRadius: BorderRadius.circular(28),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        borderRadius: BorderRadius.circular(28),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(28),
            boxShadow: [_SoftCommerceTheme.tightShadow],
          ),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: const BoxDecoration(
                  color: _SoftCommerceTheme.ink,
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: _SoftCommerceTheme.surface),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: _SoftCommerceTheme.ink,
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: _SoftCommerceTheme.muted,
                        fontSize: 12,
                        height: 1.35,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded),
            ],
          ),
        ),
      ),
    );
  }
}

class SoftSkeletonResultList extends StatelessWidget {
  const SoftSkeletonResultList({super.key});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const gutter = 14.0;
        final columnWidth = (constraints.maxWidth - gutter) / 2;
        return Wrap(
          spacing: gutter,
          runSpacing: 16,
          children: [
            for (var index = 0; index < 6; index += 1)
              SizedBox(width: columnWidth, child: const SoftSkeletonCard()),
          ],
        );
      },
    );
  }
}

class SoftSkeletonCard extends StatelessWidget {
  const SoftSkeletonCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(32),
        boxShadow: [_SoftCommerceTheme.shadow],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 1,
            child: Container(
              decoration: BoxDecoration(
                color: _SoftCommerceTheme.recessed,
                borderRadius: BorderRadius.circular(24),
              ),
            ),
          ),
          const SizedBox(height: 12),
          const SoftSkeletonLine(widthFactor: 0.86),
          const SizedBox(height: 8),
          const SoftSkeletonLine(widthFactor: 0.58),
          const SizedBox(height: 14),
          const SoftSkeletonLine(widthFactor: 0.42, height: 18),
        ],
      ),
    );
  }
}

class SoftSkeletonLine extends StatelessWidget {
  const SoftSkeletonLine({
    required this.widthFactor,
    this.height = 12,
    super.key,
  });

  final double widthFactor;
  final double height;

  @override
  Widget build(BuildContext context) {
    return FractionallySizedBox(
      widthFactor: widthFactor,
      child: Container(
        height: height,
        decoration: BoxDecoration(
          color: _SoftCommerceTheme.recessed,
          borderRadius: BorderRadius.circular(999),
        ),
      ),
    );
  }
}

class SoftEmptyResults extends StatelessWidget {
  const SoftEmptyResults({required this.onLoosen, super.key});

  final VoidCallback onLoosen;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: _SoftCommerceTheme.surface,
        borderRadius: BorderRadius.circular(34),
        boxShadow: [_SoftCommerceTheme.shadow],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '当前条件太严格',
            style: TextStyle(
              color: _SoftCommerceTheme.ink,
              fontSize: 22,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            '可以放宽预算或库存条件，继续沿用当前对话链路查找。',
            style: TextStyle(
              color: _SoftCommerceTheme.muted,
              fontSize: 14,
              height: 1.45,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 16),
          SoftPrimaryButton(
            label: '放宽到 600 以内',
            icon: Icons.tune_rounded,
            onPressed: onLoosen,
          ),
        ],
      ),
    );
  }
}

String? _detailShopName(Map<String, dynamic>? detail) {
  if (detail == null) return null;
  final shop = _softMap(detail['shop']);
  final shopName = shop['shopName']?.toString().trim();
  return shopName == null || shopName.isEmpty ? null : shopName;
}

String? _detailDecisionText(Map<String, dynamic> detail) {
  final support = _softMap(detail['decisionSupport']);
  for (final key in [
    'priorityReason',
    'priceConclusion',
    'stockConclusion',
    'shopConclusion',
  ]) {
    final text = support[key]?.toString().trim();
    if (text != null && text.isNotEmpty) return text;
  }
  final reasons = detail['recommendationReason'];
  if (reasons is List && reasons.isNotEmpty) {
    return reasons.first?.toString();
  }
  return null;
}

String? _detailDeliveryText(Map<String, dynamic> detail) {
  final delivery = _softMap(detail['deliveryEtaReference']);
  final shipTime = delivery['shipTimeText']?.toString().trim();
  final deliveryTime = delivery['deliveryTimeText']?.toString().trim();
  if (shipTime == null &&
      deliveryTime == null &&
      delivery['shipFrom'] == null) {
    return null;
  }
  final parts = [
    if (delivery['shipFrom'] != null) '发货地 ${delivery['shipFrom']}',
    if (shipTime != null && shipTime.isNotEmpty) shipTime,
    if (deliveryTime != null && deliveryTime.isNotEmpty) deliveryTime,
  ];
  return parts.join(' · ');
}

Map<String, dynamic> _softMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
  }
  return const {};
}

List<dynamic> _jsonList(dynamic value) {
  if (value is List) return value;
  return const [];
}

List<String> _jsonStringList(dynamic value) {
  return [
    for (final item in _jsonList(value))
      if (item != null) item.toString(),
  ];
}

String? _jsonOptionalString(dynamic value) {
  final text = value?.toString().trim();
  return text == null || text.isEmpty ? null : text;
}

double _jsonDouble(dynamic value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value) ?? 0;
  return 0;
}

int? _jsonInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

String _lowestPriceText(List<DemoCandidate> candidates) {
  if (candidates.isEmpty) return '暂无价格';
  final lowest =
      candidates.map((candidate) => candidate.amount).reduce(min).round();
  return '¥$lowest';
}

class AuroraHomePage extends StatefulWidget {
  const AuroraHomePage({super.key});

  @override
  State<AuroraHomePage> createState() => _AuroraHomePageState();
}

class _AuroraHomePageState extends State<AuroraHomePage> {
  final _promptController = TextEditingController();
  final _promptFocusNode = FocusNode();
  final _tips = const [
    '可以直接说出预算、尺码和想要的风格。',
    '拍参考图、上传图片、语音描述都能开始搜索。',
    '想收敛结果时，继续补充一句要求就行。',
    '首版先聚焦鞋类识别、候选商品和对比决策。',
  ];

  Timer? _tipTimer;
  int _tipIndex = 0;
  bool _isPicking = false;
  bool _isListening = false;
  bool _isLocating = false;
  String _cityLabel = '定位';
  double _assistantBottomOffset = 106;

  @override
  void initState() {
    super.initState();
    _tipTimer = Timer.periodic(const Duration(seconds: 6), (_) {
      if (!mounted) return;
      setState(() => _tipIndex = (_tipIndex + 1) % _tips.length);
    });
  }

  @override
  void dispose() {
    _tipTimer?.cancel();
    _promptController.dispose();
    _promptFocusNode.dispose();
    super.dispose();
  }

  Future<String?> _listenForVoiceText() async {
    if (_isListening) return null;

    setState(() => _isListening = true);
    try {
      await voiceChannel.invokeMethod<bool>('ensurePermission');
      final spokenText = await voiceChannel.invokeMethod<String>('listen');
      if (!mounted) return null;
      final text = spokenText?.trim();
      if (text == null || text.isEmpty) {
        _showVoiceMessage('没有听到内容，可以直接输入。');
        return null;
      }
      return text;
    } on PlatformException catch (error) {
      if (!mounted) return null;
      _showVoiceMessage(error.message ?? '暂时无法使用语音输入。');
      return null;
    } on MissingPluginException {
      if (!mounted) return null;
      _showVoiceMessage('当前平台暂不支持语音输入，可以先手动输入。');
      return null;
    } finally {
      if (mounted) setState(() => _isListening = false);
    }
  }

  Future<void> _startVoiceSearch() async {
    final text = await _listenForVoiceText();
    if (!mounted || text == null) return;
    _promptController.text = text;
    _promptController.selection = TextSelection.collapsed(offset: text.length);
    final remoteCandidates = requirementSubmitter.submitVoiceSearch(text);
    if (!mounted) return;
    _showVoiceMessage('正在按语音描述搜索。');
    await _openResultsWithLoading(
      ResultsPage(
        imageFile: null,
        initialPrompt: text,
        pendingRemoteCandidates: remoteCandidates,
      ),
    );
  }

  Future<void> _submitInitialRequirement() async {
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty) {
      _showVoiceMessage('先输入一句想找的商品或要求。');
      return;
    }
    FocusScope.of(context).unfocus();
    final remoteCandidates = requirementSubmitter.submitInitialRequirement(
      prompt,
    );
    if (!mounted) return;
    await _openResultsWithLoading(
      ResultsPage(
        imageFile: null,
        initialPrompt: prompt,
        pendingRemoteCandidates: remoteCandidates,
      ),
    );
  }

  Future<void> _openResultsWithLoading(Widget resultPage) async {
    await Navigator.of(context).push(
      PageRouteBuilder<void>(
        transitionDuration: const Duration(milliseconds: 360),
        pageBuilder: (_, animation, __) => FadeTransition(
          opacity: animation,
          child: SearchTransitionPage(nextPage: resultPage),
        ),
      ),
    );
  }

  void _startNewChat() {
    _promptController.clear();
    _promptFocusNode.requestFocus();
  }

  void _openAssistantHelp() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => const AssistantHelpSheet(),
    );
  }

  Future<void> _loadCurrentCity({bool silent = false}) async {
    if (_isLocating) return;
    setState(() => _isLocating = true);
    try {
      final city = await locationChannel.invokeMethod<String>('currentCity');
      if (!mounted) return;
      final normalized = city?.trim();
      setState(() {
        _cityLabel =
            normalized == null || normalized.isEmpty ? '未知城市' : normalized;
      });
    } on PlatformException catch (error) {
      if (!mounted) return;
      setState(() => _cityLabel = '定位');
      if (!silent) _showVoiceMessage(error.message ?? '暂时无法获取定位。');
    } on MissingPluginException {
      if (!mounted) return;
      setState(() => _cityLabel = '定位');
      if (!silent) _showVoiceMessage('当前平台暂不支持定位。');
    } finally {
      if (mounted) setState(() => _isLocating = false);
    }
  }

  void _showVoiceMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 2),
        ),
      );
  }

  Future<void> _chooseImageSource() async {
    if (_isPicking) return;
    final captured = await openSoleLensCapturePage(context);
    if (!mounted || captured == null) return;
    setState(() => _isPicking = true);
    try {
      await _startImageSearchFromFile(
        captured.file,
        source: captured.source,
        requireSubjectSelection: false,
      );
    } finally {
      if (mounted) setState(() => _isPicking = false);
    }
  }

  void _moveAssistantBubble(DragUpdateDetails details) {
    final screenHeight = MediaQuery.sizeOf(context).height;
    final safeTop = MediaQuery.paddingOf(context).top;
    final maxBottom = max(180.0, screenHeight - safeTop - 150.0);
    setState(() {
      _assistantBottomOffset = (_assistantBottomOffset - details.delta.dy)
          .clamp(28.0, maxBottom)
          .toDouble();
    });
  }

  Future<void> _startImageSearchFromFile(
    File sourceFile, {
    required ImageSource source,
    bool requireSubjectSelection = true,
  }) async {
    RecognitionImageSelection? selection;
    if (requireSubjectSelection) {
      selection = await _defaultSubjectSelectionForImage(sourceFile);
      if (!mounted) return;
    }

    final compressedImage = await RecognitionImageCompressor.compress(
      sourceFile,
    );
    debugPrint(
      'recognition image ${compressedImage.originalBytes} -> '
      '${compressedImage.compressedBytes} bytes, '
      'edge=${compressedImage.targetLongEdge}, '
      'quality=${compressedImage.quality}, '
      'fallback=${compressedImage.usedFallback}',
    );
    final imageFile = compressedImage.file;
    final remoteSession = requirementSubmitter.createSessionFromImage(
      imageFile: imageFile,
      source: source,
      selection: selection,
    );
    if (!mounted) return;

    await _openResultsWithLoading(
      ResultsPage(
        imageFile: imageFile,
        initialPrompt: _promptController.text.trim(),
        pendingRemoteSession: remoteSession,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: true,
      drawerScrimColor: Colors.black.withValues(alpha: 0.50),
      drawer: HomeHistoryDrawer(onNewChat: _startNewChat),
      body: Stack(
        children: [
          const Positioned.fill(child: AnimatedAuroraBackdrop(intense: true)),
          SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final pageHeight = max(constraints.maxHeight, 650.0);
                return SingleChildScrollView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(18, 12, 18, 24),
                  child: SizedBox(
                    height: pageHeight - 36,
                    child: Column(
                      children: [
                        Builder(
                          builder: (context) => HomeTopBar(
                            onMenuPressed: () =>
                                Scaffold.of(context).openDrawer(),
                            cityLabel: _cityLabel,
                            isLocating: _isLocating,
                            onLocationPressed: () => _loadCurrentCity(),
                          ),
                        ),
                        const Spacer(flex: 2),
                        const HomeHeroPrompt(),
                        const Spacer(flex: 2),
                        HomeSearchDock(
                          controller: _promptController,
                          focusNode: _promptFocusNode,
                          isListening: _isListening,
                          isPicking: _isPicking,
                          onSubmit: _submitInitialRequirement,
                          onCameraPressed: _chooseImageSource,
                          onVoicePressed: _startVoiceSearch,
                        ),
                        const Spacer(),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          Positioned(
            right: 16,
            bottom: _assistantBottomOffset,
            child: SafeArea(
              top: false,
              child: GestureDetector(
                behavior: HitTestBehavior.translucent,
                onVerticalDragUpdate: _moveAssistantBubble,
                child: AssistantBubble(
                  message: _tips[_tipIndex],
                  onAssistantTap: _openAssistantHelp,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class SearchTransitionPage extends StatefulWidget {
  const SearchTransitionPage({
    required this.nextPage,
    super.key,
  });

  final Widget nextPage;

  @override
  State<SearchTransitionPage> createState() => _SearchTransitionPageState();
}

class _SearchTransitionPageState extends State<SearchTransitionPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1050),
    )..forward();
    unawaited(_goNext());
  }

  Future<void> _goNext() async {
    await Future<void>.delayed(const Duration(milliseconds: 960));
    if (!mounted) return;
    await Navigator.of(context).pushReplacement(
      PageRouteBuilder<void>(
        transitionDuration: const Duration(milliseconds: 320),
        pageBuilder: (_, animation, __) => FadeTransition(
          opacity: animation,
          child: widget.nextPage,
        ),
      ),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          return Stack(
            children: [
              Positioned.fill(
                child: CustomPaint(
                  painter: SearchTransitionPainter(
                    progress: Curves.easeInOut.transform(_controller.value),
                  ),
                ),
              ),
              SafeArea(
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const BrandMark(size: 78, radius: 24),
                      const SizedBox(height: 24),
                      const Text(
                        '正在生成候选池',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '从黑夜检索到黎明结果',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.68),
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 28),
                      SizedBox(
                        width: 172,
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(999),
                          child: LinearProgressIndicator(
                            value: _controller.value,
                            minHeight: 5,
                            backgroundColor:
                                Colors.white.withValues(alpha: 0.10),
                            valueColor: const AlwaysStoppedAnimation<Color>(
                              Color(0xFFFFD18A),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class SearchTransitionPainter extends CustomPainter {
  SearchTransitionPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final sky = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          Color.lerp(
              const Color(0xFF01020A), const Color(0xFF201B3D), progress)!,
          Color.lerp(
              const Color(0xFF07061A), const Color(0xFF5C4B79), progress)!,
          Color.lerp(
              const Color(0xFF11102E), const Color(0xFFFFB46F), progress)!,
          Color.lerp(
              const Color(0xFF000105), const Color(0xFFFFE2B9), progress)!,
        ],
        stops: const [0, 0.42, 0.76, 1],
      ).createShader(rect);
    canvas.drawRect(rect, sky);

    final gridPaint = Paint();
    for (var x = 7.0; x < size.width; x += 14) {
      for (var y = 8.0; y < size.height * 0.72; y += 14) {
        final fade = (1 - progress * 0.65).clamp(0.0, 1.0);
        gridPaint.color = Colors.white.withValues(alpha: 0.08 * fade);
        canvas.drawCircle(Offset(x, y), 0.62, gridPaint);
      }
    }

    final sunCenter = Offset(size.width * 0.50, size.height * 0.84);
    canvas.drawCircle(
      sunCenter,
      size.width * (0.18 + progress * 0.24),
      Paint()
        ..shader = RadialGradient(
          colors: [
            const Color(0xFFFFF3D3).withValues(alpha: 0.62 * progress),
            const Color(0xFFFFA05C).withValues(alpha: 0.22 * progress),
            Colors.transparent,
          ],
        ).createShader(Rect.fromCircle(
          center: sunCenter,
          radius: size.width * 0.42,
        )),
    );
  }

  @override
  bool shouldRepaint(covariant SearchTransitionPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class ResultsPage extends StatefulWidget {
  const ResultsPage({
    required this.imageFile,
    required this.initialPrompt,
    this.remoteSessionId,
    this.remoteCandidates,
    this.pendingRemoteSession,
    this.pendingRemoteCandidates,
    super.key,
  });

  final File? imageFile;
  final String initialPrompt;
  final String? remoteSessionId;
  final List<DemoCandidate>? remoteCandidates;
  final Future<RemoteSessionDraft?>? pendingRemoteSession;
  final Future<List<DemoCandidate>?>? pendingRemoteCandidates;

  @override
  State<ResultsPage> createState() => _ResultsPageState();
}

class _ResultsPageState extends State<ResultsPage>
    with TickerProviderStateMixin {
  late final TextEditingController _promptController;
  late final AnimationController _streamController;
  late final AnimationController _skyController;
  late String _sessionId;
  late List<DemoCandidate> _candidates;
  int _visibleCount = 0;
  int _streamRunId = 0;
  bool _isStreaming = true;
  bool _isListening = false;
  bool _waitingForInitialRemote = false;
  MvpFilterSpec _filterSpec = const MvpFilterSpec();
  CandidateSortMode _sortMode = CandidateSortMode.match;
  String? _selectedShoeSize;
  final List<DemoCandidate> _comparePool = [];
  final List<DemoCandidate> _shortlistPool = [];
  SoftBackendSuggestionDraft? _backendSuggestion;
  String? _loadingSuggestionCardId;

  List<DemoCandidate> get _filteredCandidates {
    final candidates =
        _candidates.where(_filterSpec.matches).toList(growable: false);
    final sorted = candidates.toList();
    switch (_sortMode) {
      case CandidateSortMode.match:
        sorted.sort(compareCandidatesByMatch);
      case CandidateSortMode.price:
        sorted.sort((a, b) => a.amount.compareTo(b.amount));
      case CandidateSortMode.priceHigh:
        sorted.sort((a, b) => b.amount.compareTo(a.amount));
      case CandidateSortMode.rating:
        sorted.sort((a, b) => b.rating.compareTo(a.rating));
      case CandidateSortMode.delivery:
        sorted.sort((a, b) => a.deliveryDays.compareTo(b.deliveryDays));
    }
    return sorted;
  }

  List<DemoCandidate> get _presentationCandidates => _filteredCandidates;

  List<DemoSuggestion> get _suggestions {
    final suggestions = <DemoSuggestion>[];
    if (_filteredCandidates.isEmpty && _filterSpec.priceMax != null) {
      final nextPrice = (_filterSpec.priceMax! + 100).clamp(400, 900).round();
      suggestions.add(
        DemoSuggestion(
          title: '放宽到 $nextPrice 以内',
          reason: '当前条件太紧',
          prompt: '$nextPrice以内',
          icon: Icons.tune_rounded,
          color: const Color(0xFFFFD37B),
        ),
      );
    }
    if (!_filterSpec.stockOnly) {
      suggestions.add(
        const DemoSuggestion(
          title: '只看有货',
          reason: '减少无效候选',
          prompt: '只看有货',
          icon: Icons.inventory_2_rounded,
          color: Color(0xFF8BFFD9),
        ),
      );
    }
    if (_filterSpec.priceMax == null || _filterSpec.priceMax! > 500) {
      suggestions.add(
        const DemoSuggestion(
          title: '500 以内',
          reason: '预算收敛',
          prompt: '500以内',
          icon: Icons.currency_yen_rounded,
          color: Color(0xFF93B8FF),
        ),
      );
    }
    if (!_filterSpec.cheapestFirst) {
      suggestions.add(
        const DemoSuggestion(
          title: '先看最低价',
          reason: '按价格排序',
          prompt: '先看最低价',
          icon: Icons.south_rounded,
          color: Color(0xFFFFA4D3),
        ),
      );
    }
    return suggestions.take(3).toList(growable: false);
  }

  @override
  void initState() {
    super.initState();
    _sessionId = widget.remoteSessionId ??
        'LOCAL-${DateTime.now().millisecondsSinceEpoch.toRadixString(36).toUpperCase()}';
    _waitingForInitialRemote = widget.pendingRemoteSession != null ||
        widget.pendingRemoteCandidates != null;
    _candidates = widget.remoteCandidates?.isNotEmpty == true
        ? widget.remoteCandidates!
        : const [];
    _selectedShoeSize = UserPreferenceMemory.shoeSize;
    if (widget.initialPrompt.isNotEmpty) {
      _filterSpec = _filterSpec.mergePrompt(widget.initialPrompt);
      _sortMode = _sortModeFromPrompt(widget.initialPrompt) ??
          (_filterSpec.cheapestFirst ? CandidateSortMode.price : _sortMode);
    }
    _promptController = TextEditingController();
    _streamController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat();
    _skyController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 9),
    )..repeat();
    sessionShoppingCartStore.addListener(_handleCartStoreChanged);
    unawaited(sessionShoppingCartStore.refreshSession(_sessionId));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _syncShortlistFromCart();
    });
    unawaited(_streamCards());
    if (widget.pendingRemoteSession != null) {
      unawaited(_applyRemoteSession(widget.pendingRemoteSession!));
    }
    if (widget.pendingRemoteCandidates != null) {
      unawaited(_applyRemoteCandidates(widget.pendingRemoteCandidates!));
    }
    if (!_sessionId.startsWith('LOCAL-') && _candidates.isNotEmpty) {
      unawaited(_loadBackendSuggestions());
    }
  }

  @override
  void dispose() {
    sessionShoppingCartStore.removeListener(_handleCartStoreChanged);
    _promptController.dispose();
    _streamController.dispose();
    _skyController.dispose();
    super.dispose();
  }

  Future<void> _streamCards() async {
    final runId = ++_streamRunId;
    final streamCandidates = _presentationCandidates;
    final count = streamCandidates.length;
    if (count == 0 && _waitingForInitialRemote) {
      setState(() {
        _visibleCount = 0;
        _isStreaming = true;
      });
      return;
    }
    setState(() {
      _visibleCount = count == 0 ? 0 : 1;
      _isStreaming = true;
    });

    for (var index = _visibleCount; index < count; index += 1) {
      await Future<void>.delayed(const Duration(milliseconds: 220));
      if (!mounted || runId != _streamRunId) return;
      setState(() {
        _visibleCount = index + 1;
      });
    }

    if (!mounted || runId != _streamRunId) return;
    setState(() {
      _isStreaming = false;
    });
  }

  Future<void> _submitPrompt([String? quickPrompt]) async {
    final prompt = quickPrompt ?? _promptController.text.trim();
    if (prompt.isEmpty) return;
    FocusScope.of(context).unfocus();
    final remoteTurn = _sessionId.startsWith('LOCAL-')
        ? requirementSubmitter.submitInitialRequirement(prompt).then(
              (candidates) => candidates == null
                  ? null
                  : RemoteCandidatePage(
                      candidates: candidates,
                      nextCursor: null,
                      hasMore: false,
                    ),
            )
        : requirementSubmitter.submitSessionTurnPage(
            sessionId: _sessionId,
            text: prompt,
          );
    setState(() {
      if (_sessionId.startsWith('LOCAL-')) {
        _filterSpec = _filterSpec.mergePrompt(prompt);
        _sortMode = _sortModeFromPrompt(prompt) ??
            (_filterSpec.cheapestFirst ? CandidateSortMode.price : _sortMode);
      }
      _promptController.clear();
    });
    if (_sessionId.startsWith('LOCAL-')) unawaited(_streamCards());
    await _applyRemoteTurn(remoteTurn);
  }

  Future<void> _applyRemoteTurn(
    Future<RemoteCandidatePage?> pendingRemote,
  ) async {
    final remote = await pendingRemote;
    if (!mounted) return;
    final assistantMessage = remote?.assistantMessage?.trim();
    if (assistantMessage != null && assistantMessage.isNotEmpty) {
      _showResultMessage(assistantMessage);
    }
    if (remote == null ||
        !remote.stateChangingTurn ||
        remote.candidates.isEmpty) {
      if (_candidates.isEmpty) {
        setState(() {
          _waitingForInitialRemote = false;
        });
        unawaited(_streamCards());
      }
      return;
    }
    setState(() {
      _waitingForInitialRemote = false;
      _candidates = remote.candidates;
    });
    _retainActionPoolsForCandidates(_candidates);
    unawaited(_streamCards());
    unawaited(_loadBackendSuggestions());
  }

  Future<void> _applyRemoteCandidates(
    Future<List<DemoCandidate>?> remoteCandidates,
  ) async {
    final candidates = await remoteCandidates;
    if (!mounted) return;
    if (candidates == null || candidates.isEmpty) {
      setState(() {
        _waitingForInitialRemote = false;
      });
      unawaited(_streamCards());
      return;
    }
    setState(() {
      _waitingForInitialRemote = false;
      _candidates = candidates;
    });
    _retainActionPoolsForCandidates(_candidates);
    unawaited(_streamCards());
    unawaited(_loadBackendSuggestions());
  }

  Future<void> _applyRemoteSession(
    Future<RemoteSessionDraft?> remoteSession,
  ) async {
    final session = await remoteSession;
    if (!mounted) return;
    if (session == null || session.candidates.isEmpty) {
      setState(() {
        _waitingForInitialRemote = false;
      });
      unawaited(_streamCards());
      return;
    }
    setState(() {
      _waitingForInitialRemote = false;
      _sessionId = session.sessionId;
      _candidates = session.candidates;
    });
    _retainActionPoolsForCandidates(_candidates);
    unawaited(sessionShoppingCartStore.refreshSession(_sessionId));
    unawaited(_streamCards());
    unawaited(_loadBackendSuggestions());
  }

  Future<void> _loadBackendSuggestions() async {
    if (_sessionId.startsWith('LOCAL-')) return;
    final suggestions = await requirementSubmitter.fetchSessionSuggestions(
      _sessionId,
    );
    if (!mounted || suggestions == null) return;
    setState(() => _backendSuggestion = suggestions);
  }

  Future<void> _executeSuggestionAction(SoftSuggestionAction action) async {
    if (_loadingSuggestionCardId != null) return;
    final loadingKey = action.cardId.isNotEmpty ? action.cardId : action.title;
    setState(() => _loadingSuggestionCardId = loadingKey);
    try {
      switch (action.actionType) {
        case 'submit_turn':
          if (action.prompt.isNotEmpty) await _submitPrompt(action.prompt);
          break;
        case 'open_price_history':
        case 'open_candidate_detail':
          _openCandidateFromSuggestion(action, showTrendOutfit: false);
          break;
        case 'open_trend_outfit':
          _openCandidateFromSuggestion(action, showTrendOutfit: true);
          break;
        case 'open_filter_sheet':
          await _openSuggestionFilterSheet(action);
          break;
        default:
          if (action.prompt.isNotEmpty) await _submitPrompt(action.prompt);
          break;
      }
    } finally {
      if (mounted) setState(() => _loadingSuggestionCardId = null);
    }
  }

  void _openCandidateFromSuggestion(
    SoftSuggestionAction action, {
    required bool showTrendOutfit,
  }) {
    final candidate = _candidateById(action.candidateItemId) ??
        (_presentationCandidates.isNotEmpty
            ? _presentationCandidates.first
            : null);
    if (candidate == null) return;
    if (showTrendOutfit || action.actionType == 'open_price_history') {
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => FigmaProductDetailPage(
            candidate: candidate,
            sessionId: _sessionId,
            showTrendOutfit: showTrendOutfit,
          ),
        ),
      );
      return;
    }
    _openCandidate(candidate);
  }

  DemoCandidate? _candidateById(String? candidateItemId) {
    if (candidateItemId == null || candidateItemId.isEmpty) return null;
    for (final candidate in _candidates) {
      if (candidate.candidateItemId == candidateItemId) return candidate;
    }
    return null;
  }

  Future<void> _openSuggestionFilterSheet(SoftSuggestionAction action) async {
    if (action.field == 'size') {
      final size = await showModalBottomSheet<String>(
        context: context,
        backgroundColor: Colors.transparent,
        builder: (context) => const FigmaSuggestionSizeSheet(),
      );
      if (!mounted || size == null || size.isEmpty) return;
      await _submitPrompt('只看$size码');
      return;
    }
    await _openAdvancedFilterSheet();
  }

  void _handleCartStoreChanged() {
    if (!mounted) return;
    _syncShortlistFromCart();
  }

  void _changeSortMode(CandidateSortMode mode) {
    if (_sortMode == mode) return;
    setState(() => _sortMode = mode);
    unawaited(_streamCards());
  }

  void _applyFilterSpec(MvpFilterSpec spec) {
    setState(() {
      _filterSpec = spec;
      if (spec.cheapestFirst) _sortMode = CandidateSortMode.price;
    });
    unawaited(_streamCards());
  }

  Future<void> _openSortSheet() async {
    final selected = await showModalBottomSheet<CandidateSortMode>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => SortModeSheet(current: _sortMode),
    );
    if (selected != null) _changeSortMode(selected);
  }

  Future<void> _openPlatformSheet() async {
    final selected = await showModalBottomSheet<String?>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => PlatformFilterSheet(current: _filterSpec.platform),
    );
    if (!mounted) return;
    if (selected == '__clear__') {
      _applyFilterSpec(_filterSpec.withPlatform(null));
    } else if (selected != null) {
      _applyFilterSpec(_filterSpec.withPlatform(selected));
    }
  }

  Future<void> _openAdvancedFilterSheet() async {
    final selected = await showModalBottomSheet<MvpFilterSpec>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => AdvancedFilterSheet(initial: _filterSpec),
    );
    if (selected != null) _applyFilterSpec(selected);
  }

  CandidateSortMode? _sortModeFromPrompt(String prompt) {
    if (prompt.contains('好评') ||
        prompt.contains('评分') ||
        prompt.contains('评价')) {
      return CandidateSortMode.rating;
    }
    if (prompt.contains('送达') ||
        prompt.contains('到货') ||
        prompt.contains('最快')) {
      return CandidateSortMode.delivery;
    }
    if (prompt.contains('最低') ||
        prompt.contains('低价') ||
        prompt.contains('便宜') ||
        prompt.contains('价格优先')) {
      return CandidateSortMode.price;
    }
    if (prompt.contains('最高价') ||
        prompt.contains('高价优先') ||
        prompt.contains('贵的优先')) {
      return CandidateSortMode.priceHigh;
    }
    return null;
  }

  Future<void> _saveShoeSize(String? shoeSize) async {
    if (shoeSize == null || shoeSize.isEmpty) return;
    setState(() => _selectedShoeSize = shoeSize);
    UserPreferenceMemory.shoeSize = shoeSize;
    await requirementSubmitter.saveShoeSizePreference(shoeSize);
    if (!mounted) return;
    _showResultMessage('已保存鞋码，下次会默认带入。');
  }

  Future<void> _startVoiceInput() async {
    if (_isListening) return;

    setState(() => _isListening = true);
    try {
      await voiceChannel.invokeMethod<bool>('ensurePermission');
      final spokenText = await voiceChannel.invokeMethod<String>('listen');
      if (!mounted) return;
      final text = spokenText?.trim();
      if (text == null || text.isEmpty) {
        _showResultMessage('没有听到内容，可以直接输入。');
        return;
      }
      _submitPrompt(text);
      _showResultMessage('已按语音要求继续收敛。');
    } on PlatformException catch (error) {
      if (!mounted) return;
      _showResultMessage(error.message ?? '暂时无法使用语音输入。');
    } on MissingPluginException {
      if (!mounted) return;
      _showResultMessage('当前平台暂不支持语音输入，可以先手动输入。');
    } finally {
      if (mounted) setState(() => _isListening = false);
    }
  }

  void _showResultMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 2),
        ),
      );
  }

  void _openCandidate(DemoCandidate candidate) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => CandidateDetailSheet(
        candidate: candidate,
        sessionId: _sessionId,
        isCompared: _isCompared(candidate),
        onCompareToggle: () => _toggleCompare(candidate),
        onPay: () => _openPaymentSheet(candidate),
      ),
    );
  }

  Future<void> _openCartCandidate(DemoCandidate candidate) async {
    await Navigator.of(context).push(
      PageRouteBuilder<void>(
        transitionDuration: const Duration(milliseconds: 260),
        reverseTransitionDuration: const Duration(milliseconds: 200),
        pageBuilder: (_, animation, __) => FadeTransition(
          opacity: animation,
          child: FigmaProductDetailPage(
            candidate: candidate,
            sessionId: _sessionId,
            showTrendOutfit: true,
          ),
        ),
      ),
    );
  }

  Future<void> _openSessionCart() async {
    await sessionShoppingCartStore.refreshSession(_sessionId);
    if (!mounted) return;
    await Navigator.of(context).push(
      PageRouteBuilder<void>(
        transitionDuration: const Duration(milliseconds: 260),
        reverseTransitionDuration: const Duration(milliseconds: 200),
        pageBuilder: (_, animation, __) => FadeTransition(
          opacity: animation,
          child: SessionShoppingCartPage(
            sessionId: _sessionId,
            title:
                widget.initialPrompt.isEmpty ? '当前对话购物车' : widget.initialPrompt,
          ),
        ),
      ),
    );
  }

  void _openPaymentSheet(DemoCandidate candidate) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => PaymentActionSheet(candidate: candidate),
    );
  }

  bool _isCompared(DemoCandidate candidate) {
    return _comparePool.any(
      (item) => item.candidateItemId == candidate.candidateItemId,
    );
  }

  void _toggleCompare(DemoCandidate candidate) {
    setState(() {
      final existingIndex = _comparePool.indexWhere(
        (item) => item.candidateItemId == candidate.candidateItemId,
      );
      if (existingIndex >= 0) {
        _comparePool.removeAt(existingIndex);
        return;
      }
      if (_comparePool.length >= 2) {
        _comparePool.removeAt(0);
      }
      _comparePool.add(candidate);
    });
  }

  void _shortlistCandidate(DemoCandidate candidate) {
    final candidateId = candidate.candidateItemId;
    var added = false;
    setState(() {
      if (!_shortlistPool.any((item) => item.candidateItemId == candidateId)) {
        _shortlistPool.add(candidate);
        added = true;
      }
      _candidates = _candidates
          .where((item) => item.candidateItemId != candidateId)
          .toList(growable: false);
      _visibleCount = min(_visibleCount, _presentationCandidates.length);
    });

    if (added) {
      _showResultMessage('已加入购物车，正在后台生成搭配推荐。');
    }
    unawaited(
      sessionShoppingCartStore.addCandidate(
        sessionId: _sessionId,
        candidate: candidate,
      ),
    );
  }

  void _removeFromShortlist(DemoCandidate candidate) {
    final candidateId = candidate.candidateItemId;
    setState(() {
      _shortlistPool.removeWhere(
        (item) => item.candidateItemId == candidateId,
      );
      if (!_candidates.any((item) => item.candidateItemId == candidateId)) {
        _candidates = [candidate, ..._candidates];
        _visibleCount = min(
          max(_visibleCount, 1),
          _presentationCandidates.length,
        );
      }
    });
    unawaited(
      sessionShoppingCartStore.removeCandidate(
        sessionId: _sessionId,
        candidate: candidate,
      ),
    );
  }

  void _retainActionPoolsForCandidates(List<DemoCandidate> candidates) {
    final candidateIds = candidates
        .map((candidate) => candidate.candidateItemId)
        .where((candidateId) => candidateId.isNotEmpty)
        .toSet();
    _comparePool.removeWhere(
      (item) => !candidateIds.contains(item.candidateItemId),
    );
    _syncShortlistFromCart();
  }

  void _syncShortlistFromCart() {
    final cartItems = sessionShoppingCartStore.itemsFor(_sessionId);
    final cartIds = cartItems
        .map((candidate) => candidate.candidateItemId)
        .where((candidateId) => candidateId.isNotEmpty)
        .toSet();
    setState(() {
      _shortlistPool
        ..clear()
        ..addAll(cartItems);
      if (cartIds.isEmpty) return;
      _candidates = _candidates
          .where((item) => !cartIds.contains(item.candidateItemId))
          .toList(growable: false);
      _visibleCount = min(_visibleCount, _presentationCandidates.length);
    });
  }

  @override
  Widget build(BuildContext context) {
    final visibleCandidates =
        _presentationCandidates.take(_visibleCount).toList();
    final suggestions = _suggestions;
    final backendSuggestions = _backendSuggestion;
    return Scaffold(
      resizeToAvoidBottomInset: true,
      body: Stack(
        children: [
          const Positioned.fill(child: WarmResultBackdrop()),
          SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
              children: [
                _ResultTopBar(
                  title: widget.imageFile == null ? '语音搜索结果' : '搜索结果',
                  onBack: () => Navigator.of(context).pop(),
                  cartCount: sessionShoppingCartStore.countFor(_sessionId),
                  onCartPressed: () => unawaited(_openSessionCart()),
                ),
                const SizedBox(height: 10),
                PromptDock(
                  controller: _promptController,
                  hintText: '继续收敛：500以内，只看有货',
                  onSubmit: () => _submitPrompt(),
                  onVoicePressed: _startVoiceInput,
                  isListening: _isListening,
                ),
                const SizedBox(height: 8),
                QuickPromptRow(onSelected: _submitPrompt),
                const SizedBox(height: 12),
                ShoeRequiredInfoPanel(
                  selectedSize: _selectedShoeSize,
                  onSizeChanged: _saveShoeSize,
                ),
                if (_shortlistPool.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  ShortlistPoolPanel(
                    candidates: _shortlistPool,
                    onOpen: (candidate) =>
                        unawaited(_openCartCandidate(candidate)),
                    onRemove: _removeFromShortlist,
                  ),
                ],
                if (_comparePool.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  ComparisonPoolPanel(
                    candidates: _comparePool,
                    onRemove: _toggleCompare,
                  ),
                ],
                if (backendSuggestions?.actions.isNotEmpty == true) ...[
                  const SizedBox(height: 12),
                  FigmaResultRecommendationRail(
                    suggestion: backendSuggestions,
                    loadingActionId: _loadingSuggestionCardId,
                    onSelected: (action) =>
                        unawaited(_executeSuggestionAction(action)),
                  ),
                ],
                const SizedBox(height: 12),
                ProductListToolbar(
                  sortMode: _sortMode,
                  filterSpec: _filterSpec,
                  onSortPressed: _openSortSheet,
                  onPlatformPressed: _openPlatformSheet,
                  onFilterPressed: _openAdvancedFilterSheet,
                ),
                const SizedBox(height: 8),
                AnimatedBuilder(
                  animation: _streamController,
                  builder: (context, _) {
                    return RankedStreamedCandidateList(
                      candidates: visibleCandidates,
                      isStreaming: _isStreaming,
                      shimmer: _streamController.value,
                      onOpen: _openCandidate,
                      onPay: _openPaymentSheet,
                      onShortlist: _shortlistCandidate,
                    );
                  },
                ),
                if (!_isStreaming && visibleCandidates.isEmpty)
                  EmptyResultsCard(
                    onLoosen: () => _submitPrompt('放宽到600以内'),
                  ),
                if (backendSuggestions?.actions.isNotEmpty != true &&
                    suggestions.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  MvpSuggestionStrip(
                    suggestions: suggestions,
                    onSelected: (suggestion) =>
                        _submitPrompt(suggestion.prompt),
                  ),
                ],
              ],
            ),
          ),
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: _skyController,
                builder: (context, _) => CustomPaint(
                  painter: WarmSparkPainter(progress: _skyController.value),
                  size: Size.infinite,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class WarmResultBackdrop extends StatefulWidget {
  const WarmResultBackdrop({super.key});

  @override
  State<WarmResultBackdrop> createState() => _WarmResultBackdropState();
}

class _WarmResultBackdropState extends State<WarmResultBackdrop>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 14),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return CustomPaint(
          painter: WarmResultPainter(progress: _controller.value),
          child: Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color(0xFF37283E),
                  Color(0xFF80615F),
                  Color(0xFFE4A24D),
                  Color(0xFFFFB139),
                ],
                stops: [0, 0.38, 0.72, 1],
              ),
            ),
          ),
        );
      },
    );
  }
}

class WarmResultPainter extends CustomPainter {
  WarmResultPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    _drawSoftGlow(
      canvas,
      rect,
      const Alignment(-0.82, -0.92),
      const Color(0xFFB7A2B6),
      0.58,
      0.30,
    );
    _drawSoftGlow(
      canvas,
      rect,
      const Alignment(0.82, -0.28),
      const Color(0xFFFFCF7A),
      0.78,
      0.38,
    );
    _drawSoftGlow(
      canvas,
      rect,
      const Alignment(-0.38, 0.72),
      const Color(0xFF3E2747),
      0.88,
      0.34,
    );

    final wave = sin(progress * 2 * pi);
    final bandPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..color = Colors.white.withValues(alpha: 0.18)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 0.7);
    final path = Path()
      ..moveTo(size.width * 0.06, size.height * (0.14 + wave * 0.012))
      ..quadraticBezierTo(
        size.width * 0.48,
        size.height * (0.09 - wave * 0.018),
        size.width * 0.94,
        size.height * (0.15 + wave * 0.014),
      )
      ..quadraticBezierTo(
        size.width * 0.98,
        size.height * 0.48,
        size.width * 0.86,
        size.height * 0.92,
      );
    canvas.drawPath(path, bandPaint);

    final vignette = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          Colors.black.withValues(alpha: 0.06),
          Colors.black.withValues(alpha: 0.22),
        ],
      ).createShader(rect);
    canvas.drawRect(rect, vignette);
  }

  void _drawSoftGlow(
    Canvas canvas,
    Rect rect,
    Alignment center,
    Color color,
    double radius,
    double alpha,
  ) {
    final paint = Paint()
      ..shader = RadialGradient(
        center: center,
        radius: radius,
        colors: [color.withValues(alpha: alpha), color.withValues(alpha: 0)],
      ).createShader(rect);
    canvas.drawRect(rect, paint);
  }

  @override
  bool shouldRepaint(covariant WarmResultPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class WarmSparkPainter extends CustomPainter {
  WarmSparkPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    const colors = [
      Color(0xFFFFF2D1),
      Color(0xFFFFC76E),
      Color(0xFFE9D4FF),
    ];
    for (var i = 0; i < 5; i += 1) {
      final local = (progress * 0.82 + i * 0.19) % 1;
      final fade = sin(local * pi).clamp(0.0, 1.0).toDouble();
      final start = Offset(
        size.width * (1.08 - local * 1.26),
        size.height * (0.08 + i * 0.16 + local * 0.06),
      );
      final end = start + Offset(-64 - i * 8, 22 + i * 3);
      final color = colors[i % colors.length];
      final paint = Paint()
        ..shader = LinearGradient(
          colors: [
            Colors.white.withValues(alpha: 0),
            color.withValues(alpha: 0.46 * fade),
            Colors.white.withValues(alpha: 0),
          ],
        ).createShader(Rect.fromPoints(start, end))
        ..strokeWidth = 1.0 + (i % 2) * 0.35
        ..strokeCap = StrokeCap.round;
      canvas.drawLine(start, end, paint);
    }
  }

  @override
  bool shouldRepaint(covariant WarmSparkPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class AnimatedAuroraBackdrop extends StatefulWidget {
  const AnimatedAuroraBackdrop({this.intense = false, super.key});

  final bool intense;

  @override
  State<AnimatedAuroraBackdrop> createState() => _AnimatedAuroraBackdropState();
}

class _AnimatedAuroraBackdropState extends State<AnimatedAuroraBackdrop>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 12),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return DecoratedBox(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Color(0xFF000000),
                Color(0xFF030309),
                Color(0xFF08081A),
                Color(0xFF141033),
                Color(0xFF080513),
                Color(0xFF000000),
              ],
              stops: [0, 0.20, 0.42, 0.60, 0.78, 1],
            ),
          ),
          child: CustomPaint(
            painter: AuroraPainter(
              progress: _controller.value,
              intense: widget.intense,
            ),
            child: const SizedBox.expand(),
          ),
        );
      },
    );
  }
}

class AuroraPainter extends CustomPainter {
  AuroraPainter({required this.progress, required this.intense});

  final double progress;
  final bool intense;

  @override
  void paint(Canvas canvas, Size size) {
    _drawSampleStyleGlow(canvas, size);
    _drawDotGrid(canvas, size);

    final vignette = Paint()
      ..shader = RadialGradient(
        center: const Alignment(0, -0.12),
        radius: 1.05,
        colors: [
          Colors.transparent,
          Colors.black.withValues(alpha: 0.52),
        ],
      ).createShader(Offset.zero & size);
    canvas.drawRect(Offset.zero & size, vignette);
  }

  void _drawDotGrid(Canvas canvas, Size size) {
    final spacing = intense ? 12.5 : 14.0;
    final maxY = size.height * 0.98;
    final paint = Paint();
    for (var x = spacing * 0.5; x < size.width; x += spacing) {
      for (var y = spacing * 0.5; y < maxY; y += spacing) {
        final shimmer =
            0.78 + 0.22 * sin(progress * 2 * pi + x * 0.018 + y * 0.012);
        final horizonLift =
            exp(-pow((y - size.height * 0.54) / (size.height * 0.24), 2));
        final topLift = y < size.height * 0.38 ? 0.55 : 0.0;
        final alpha = (0.055 + horizonLift * 0.11 + topLift * 0.05) * shimmer;
        final coldTint = (sin(x * 0.025 + y * 0.018) + 1) / 2;
        paint.color = Color.lerp(
          Colors.white,
          const Color(0xFF5CFFF0),
          coldTint * 0.28,
        )!
            .withValues(alpha: alpha.clamp(0.045, 0.20).toDouble());
        canvas.drawCircle(Offset(x, y), intense ? 0.68 : 0.56, paint);
      }
    }
  }

  void _drawSampleStyleGlow(Canvas canvas, Size size) {
    final horizon = size.height * (0.51 + sin(progress * 2 * pi) * 0.008);
    final pulse = 0.82 + 0.18 * sin(progress * 2 * pi);

    final ambientRect = Rect.fromLTWH(0, horizon - 150, size.width, 430);
    final ambientPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          Colors.transparent,
          const Color(0xFF4A63FF).withValues(alpha: 0.08),
          const Color(0xFF7D58FF).withValues(alpha: 0.26 * pulse),
          const Color(0xFF0ADFFF).withValues(alpha: 0.18),
          const Color(0xFF0B0B1C).withValues(alpha: 0.20),
          Colors.transparent,
        ],
        stops: const [0, 0.25, 0.48, 0.66, 0.80, 1],
      ).createShader(ambientRect);
    canvas.drawRect(ambientRect, ambientPaint);

    final leftWing = Path()
      ..moveTo(-size.width * 0.30, horizon - size.height * 0.18)
      ..cubicTo(
        size.width * 0.05,
        horizon - size.height * 0.06,
        size.width * 0.26,
        horizon + size.height * 0.03,
        size.width * 0.56,
        horizon + size.height * 0.07,
      )
      ..lineTo(size.width * 0.54, horizon + size.height * 0.21)
      ..cubicTo(
        size.width * 0.25,
        horizon + size.height * 0.18,
        size.width * 0.04,
        horizon + size.height * 0.10,
        -size.width * 0.28,
        horizon + size.height * 0.05,
      )
      ..close();
    final leftPaint = Paint()
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 30)
      ..shader = RadialGradient(
        center: const Alignment(-0.82, 0.15),
        radius: 0.92,
        colors: [
          const Color(0xFF25F3FF).withValues(alpha: 0.54 * pulse),
          const Color(0xFF6871FF).withValues(alpha: 0.36),
          const Color(0xFFA45BFF).withValues(alpha: 0.22),
          const Color(0x00000000),
        ],
      ).createShader(Offset.zero & size);
    canvas.drawPath(leftWing, leftPaint);

    final rightWing = Path()
      ..moveTo(size.width * 1.30, horizon - size.height * 0.18)
      ..cubicTo(
        size.width * 0.95,
        horizon - size.height * 0.06,
        size.width * 0.74,
        horizon + size.height * 0.03,
        size.width * 0.44,
        horizon + size.height * 0.07,
      )
      ..lineTo(size.width * 0.46, horizon + size.height * 0.21)
      ..cubicTo(
        size.width * 0.75,
        horizon + size.height * 0.18,
        size.width * 0.96,
        horizon + size.height * 0.10,
        size.width * 1.28,
        horizon + size.height * 0.05,
      )
      ..close();
    final rightPaint = Paint()
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 30)
      ..shader = RadialGradient(
        center: const Alignment(0.90, 0.16),
        radius: 0.92,
        colors: [
          const Color(0xFFA25DFF).withValues(alpha: 0.50 * pulse),
          const Color(0xFF4C68FF).withValues(alpha: 0.36),
          const Color(0xFF00D7FF).withValues(alpha: 0.20),
          const Color(0x00000000),
        ],
      ).createShader(Offset.zero & size);
    canvas.drawPath(rightWing, rightPaint);

    final underGlow = Paint()
      ..shader = RadialGradient(
        center: const Alignment(0.0, 0.52),
        radius: 0.82,
        colors: [
          const Color(0xFF343A81).withValues(alpha: 0.40),
          const Color(0xFF171030).withValues(alpha: 0.34),
          Colors.transparent,
        ],
      ).createShader(Offset.zero & size);
    canvas.drawRect(Offset.zero & size, underGlow);

    final hairlinePaint = Paint()
      ..shader = LinearGradient(
        colors: [
          Colors.transparent,
          const Color(0xFF7F8BFF).withValues(alpha: 0.42),
          const Color(0xFFB16DFF).withValues(alpha: 0.48),
          const Color(0xFF00E5FF).withValues(alpha: 0.32),
          Colors.transparent,
        ],
      ).createShader(Rect.fromLTWH(0, horizon, size.width, 1.6))
      ..strokeWidth = 1.1;
    canvas.drawLine(
      Offset(0, horizon),
      Offset(size.width, horizon),
      hairlinePaint,
    );
  }

  @override
  bool shouldRepaint(covariant AuroraPainter oldDelegate) {
    return oldDelegate.progress != progress || oldDelegate.intense != intense;
  }
}

class MeteorPainter extends CustomPainter {
  MeteorPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    const colors = [
      Color(0xFFEFFFFB),
      Color(0xFF8EFFF0),
      Color(0xFFFFB9DB),
      Color(0xFFFFD685),
    ];
    for (var i = 0; i < 7; i += 1) {
      final local = (progress + i * 0.137) % 1;
      final fade = sin(local * pi).clamp(0.0, 1.0).toDouble();
      final color = colors[i % colors.length];
      final start = Offset(
        size.width * (1.08 - local * 1.42),
        size.height * (0.06 + i * 0.105 + local * 0.16),
      );
      final end = start + Offset(-112 - i * 8, 44 + i * 4);
      final paint = Paint()
        ..shader = LinearGradient(
          colors: [
            Colors.white.withValues(alpha: 0),
            color.withValues(alpha: 0.72 * fade),
            Colors.white.withValues(alpha: 0),
          ],
        ).createShader(Rect.fromPoints(start, end))
        ..strokeWidth = 1.0 + (i % 3) * 0.35
        ..strokeCap = StrokeCap.round;
      canvas.drawLine(start, end, paint);
      canvas.drawCircle(
        start,
        1.4 + (i % 2) * 0.45,
        Paint()..color = color.withValues(alpha: 0.70 * fade),
      );
    }
  }

  @override
  bool shouldRepaint(covariant MeteorPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class HomeTopBar extends StatelessWidget {
  const HomeTopBar({
    required this.onMenuPressed,
    required this.cityLabel,
    required this.isLocating,
    required this.onLocationPressed,
    super.key,
  });

  final VoidCallback onMenuPressed;
  final String cityLabel;
  final bool isLocating;
  final VoidCallback onLocationPressed;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Tooltip(
          message: '历史对话',
          child: GlassIconButton(
            icon: Icons.menu_rounded,
            onPressed: onMenuPressed,
          ),
        ),
        const SizedBox(width: 12),
        const Spacer(),
        Tooltip(
          message: '获取当前位置',
          child: Material(
            color: Colors.white.withValues(alpha: 0.92),
            borderRadius: BorderRadius.circular(999),
            child: InkWell(
              borderRadius: BorderRadius.circular(999),
              onTap: onLocationPressed,
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (isLocating)
                      const SizedBox(
                        width: 15,
                        height: 15,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Color(0xFF090A10),
                        ),
                      )
                    else
                      const Icon(
                        Icons.location_on_rounded,
                        color: Color(0xFF090A10),
                        size: 17,
                      ),
                    const SizedBox(width: 5),
                    Text(
                      cityLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF090A10),
                        fontSize: 12.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class HomeHeroPrompt extends StatelessWidget {
  const HomeHeroPrompt({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const BrandMark(size: 82, radius: 26),
        const SizedBox(height: 18),
        Text(
          '拍照、语音或文字，生成可比较的商品候选。',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.72),
            fontSize: 15,
            fontWeight: FontWeight.w700,
            height: 1.45,
          ),
        ),
      ],
    );
  }
}

enum _SelectionHandle {
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
  top,
  right,
  bottom,
  left,
}

class ProductSubjectSelectionPage extends StatefulWidget {
  const ProductSubjectSelectionPage({required this.imageFile, super.key});

  final File imageFile;

  @override
  State<ProductSubjectSelectionPage> createState() =>
      _ProductSubjectSelectionPageState();
}

class _ProductSubjectSelectionPageState
    extends State<ProductSubjectSelectionPage> {
  static const _minSelectionSize = 0.16;

  Size? _imageSize;
  Rect _selection = const Rect.fromLTWH(0.18, 0.10, 0.64, 0.78);

  @override
  void initState() {
    super.initState();
    unawaited(_loadImageSize());
  }

  Future<void> _loadImageSize() async {
    final bytes = await widget.imageFile.readAsBytes();
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    final image = frame.image;
    if (!mounted) {
      image.dispose();
      codec.dispose();
      return;
    }

    setState(() {
      _imageSize = Size(image.width.toDouble(), image.height.toDouble());
      _selection = _defaultSubjectRect(_imageSize!);
    });
    image.dispose();
    codec.dispose();
  }

  Rect _defaultSubjectRect(Size imageSize) {
    if (imageSize.height >= imageSize.width) {
      return const Rect.fromLTWH(0.18, 0.10, 0.64, 0.78);
    }
    return const Rect.fromLTWH(0.14, 0.16, 0.72, 0.68);
  }

  Rect _imageRectFor(Size boxSize) {
    final imageSize = _imageSize ?? const Size(3, 4);
    final fitted = applyBoxFit(BoxFit.contain, imageSize, boxSize);
    return Alignment.center.inscribe(fitted.destination, Offset.zero & boxSize);
  }

  Rect _selectionRectFor(Rect imageRect) {
    return Rect.fromLTWH(
      imageRect.left + _selection.left * imageRect.width,
      imageRect.top + _selection.top * imageRect.height,
      _selection.width * imageRect.width,
      _selection.height * imageRect.height,
    );
  }

  void _moveSelection(DragUpdateDetails details, Rect imageRect) {
    if (imageRect.width <= 0 || imageRect.height <= 0) return;
    final nextLeft = (_selection.left + details.delta.dx / imageRect.width)
        .clamp(0.0, 1.0 - _selection.width)
        .toDouble();
    final nextTop = (_selection.top + details.delta.dy / imageRect.height)
        .clamp(0.0, 1.0 - _selection.height)
        .toDouble();
    setState(() {
      _selection = Rect.fromLTWH(
        nextLeft,
        nextTop,
        _selection.width,
        _selection.height,
      );
    });
  }

  void _resizeSelection(
    DragUpdateDetails details,
    Rect imageRect,
    _SelectionHandle handle,
  ) {
    if (imageRect.width <= 0 || imageRect.height <= 0) return;
    final dx = details.delta.dx / imageRect.width;
    final dy = details.delta.dy / imageRect.height;
    var left = _selection.left;
    var top = _selection.top;
    var right = _selection.right;
    var bottom = _selection.bottom;

    switch (handle) {
      case _SelectionHandle.topLeft:
        left += dx;
        top += dy;
      case _SelectionHandle.topRight:
        right += dx;
        top += dy;
      case _SelectionHandle.bottomLeft:
        left += dx;
        bottom += dy;
      case _SelectionHandle.bottomRight:
        right += dx;
        bottom += dy;
      case _SelectionHandle.top:
        top += dy;
      case _SelectionHandle.right:
        right += dx;
      case _SelectionHandle.bottom:
        bottom += dy;
      case _SelectionHandle.left:
        left += dx;
    }

    left = left.clamp(0.0, 1.0).toDouble();
    top = top.clamp(0.0, 1.0).toDouble();
    right = right.clamp(0.0, 1.0).toDouble();
    bottom = bottom.clamp(0.0, 1.0).toDouble();

    if (right - left < _minSelectionSize) {
      if (_isLeftHandle(handle)) {
        left = (right - _minSelectionSize).clamp(0.0, 1.0).toDouble();
      } else {
        right = (left + _minSelectionSize).clamp(0.0, 1.0).toDouble();
      }
    }
    if (bottom - top < _minSelectionSize) {
      if (_isTopHandle(handle)) {
        top = (bottom - _minSelectionSize).clamp(0.0, 1.0).toDouble();
      } else {
        bottom = (top + _minSelectionSize).clamp(0.0, 1.0).toDouble();
      }
    }

    setState(() => _selection = Rect.fromLTRB(left, top, right, bottom));
  }

  bool _isLeftHandle(_SelectionHandle handle) {
    return handle == _SelectionHandle.topLeft ||
        handle == _SelectionHandle.bottomLeft ||
        handle == _SelectionHandle.left;
  }

  bool _isTopHandle(_SelectionHandle handle) {
    return handle == _SelectionHandle.topLeft ||
        handle == _SelectionHandle.topRight ||
        handle == _SelectionHandle.top;
  }

  void _confirmSelection() {
    Navigator.of(context).pop(
      RecognitionImageSelection(
        left: _selection.left,
        top: _selection.top,
        width: _selection.width,
        height: _selection.height,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF050507),
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final boxSize = constraints.biggest;
                  final imageRect = _imageRectFor(boxSize);
                  final selectionRect = _selectionRectFor(imageRect);
                  return Stack(
                    children: [
                      Positioned.fromRect(
                        rect: imageRect,
                        child:
                            Image.file(widget.imageFile, fit: BoxFit.contain),
                      ),
                      Positioned.fill(
                        child: CustomPaint(
                          painter: SubjectSelectionPainter(
                            selectionRect: selectionRect,
                          ),
                        ),
                      ),
                      Positioned.fromRect(
                        rect: selectionRect,
                        child: GestureDetector(
                          behavior: HitTestBehavior.translucent,
                          onPanUpdate: (details) =>
                              _moveSelection(details, imageRect),
                        ),
                      ),
                      ..._buildHandles(imageRect, selectionRect),
                    ],
                  );
                },
              ),
            ),
            Positioned(
              left: 14,
              right: 14,
              top: 12,
              child: Row(
                children: [
                  IconButton.filledTonal(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                    tooltip: '取消',
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '调整识别主体',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.94),
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Positioned(
              left: 16,
              right: 16,
              bottom: 16,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(26),
                child: BackdropFilter(
                  filter: ui.ImageFilter.blur(sigmaX: 18, sigmaY: 18),
                  child: Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFF090A10).withValues(alpha: 0.72),
                      borderRadius: BorderRadius.circular(26),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.16),
                      ),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(
                              Icons.auto_awesome_rounded,
                              color: Color(0xFFFFE7A8),
                              size: 18,
                            ),
                            const SizedBox(width: 7),
                            Expanded(
                              child: Text(
                                '已先圈定画面中央较明显主体，可拖动整体或拖拽白色边界微调。',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.78),
                                  fontSize: 12.5,
                                  height: 1.35,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: () => Navigator.of(context).pop(),
                                icon: const Icon(Icons.refresh_rounded),
                                label: const Text('重选图片'),
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: Colors.white,
                                  side: BorderSide(
                                    color: Colors.white.withValues(alpha: 0.26),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: FilledButton.icon(
                                onPressed: _confirmSelection,
                                icon: const Icon(Icons.search_rounded),
                                label: const Text('确认搜索'),
                                style: FilledButton.styleFrom(
                                  backgroundColor: Colors.white,
                                  foregroundColor: const Color(0xFF090A10),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildHandles(Rect imageRect, Rect selectionRect) {
    const size = 34.0;
    return [
      _buildHandle(
        imageRect,
        Offset(selectionRect.left, selectionRect.top),
        _SelectionHandle.topLeft,
        size,
      ),
      _buildHandle(
        imageRect,
        Offset(selectionRect.right, selectionRect.top),
        _SelectionHandle.topRight,
        size,
      ),
      _buildHandle(
        imageRect,
        Offset(selectionRect.left, selectionRect.bottom),
        _SelectionHandle.bottomLeft,
        size,
      ),
      _buildHandle(
        imageRect,
        Offset(selectionRect.right, selectionRect.bottom),
        _SelectionHandle.bottomRight,
        size,
      ),
      _buildHandle(
        imageRect,
        Offset(selectionRect.center.dx, selectionRect.top),
        _SelectionHandle.top,
        size,
      ),
      _buildHandle(
        imageRect,
        Offset(selectionRect.right, selectionRect.center.dy),
        _SelectionHandle.right,
        size,
      ),
      _buildHandle(
        imageRect,
        Offset(selectionRect.center.dx, selectionRect.bottom),
        _SelectionHandle.bottom,
        size,
      ),
      _buildHandle(
        imageRect,
        Offset(selectionRect.left, selectionRect.center.dy),
        _SelectionHandle.left,
        size,
      ),
    ];
  }

  Widget _buildHandle(
    Rect imageRect,
    Offset center,
    _SelectionHandle handle,
    double size,
  ) {
    return Positioned(
      left: center.dx - size / 2,
      top: center.dy - size / 2,
      width: size,
      height: size,
      child: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onPanUpdate: (details) => _resizeSelection(details, imageRect, handle),
        child: Center(
          child: Container(
            width: 15,
            height: 15,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(5),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.35),
                  blurRadius: 10,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class SubjectSelectionPainter extends CustomPainter {
  const SubjectSelectionPainter({required this.selectionRect});

  final Rect selectionRect;

  @override
  void paint(Canvas canvas, Size size) {
    final full = Offset.zero & size;
    final dimPaint = Paint()..color = Colors.black.withValues(alpha: 0.52);
    canvas
      ..drawRect(Rect.fromLTRB(0, 0, size.width, selectionRect.top), dimPaint)
      ..drawRect(
        Rect.fromLTRB(0, selectionRect.bottom, size.width, size.height),
        dimPaint,
      )
      ..drawRect(
        Rect.fromLTRB(
            0, selectionRect.top, selectionRect.left, selectionRect.bottom),
        dimPaint,
      )
      ..drawRect(
        Rect.fromLTRB(
          selectionRect.right,
          selectionRect.top,
          size.width,
          selectionRect.bottom,
        ),
        dimPaint,
      );

    canvas.drawRect(
      selectionRect,
      Paint()..color = Colors.white.withValues(alpha: 0.10),
    );

    final borderPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..color = Colors.white.withValues(alpha: 0.50);
    canvas.drawRRect(
      RRect.fromRectAndRadius(selectionRect, const Radius.circular(18)),
      borderPaint,
    );

    final cornerPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round
      ..color = Colors.white;
    const corner = 44.0;
    const inset = 3.0;
    final left = selectionRect.left + inset;
    final top = selectionRect.top + inset;
    final right = selectionRect.right - inset;
    final bottom = selectionRect.bottom - inset;

    canvas
      ..drawLine(
          Offset(left, top + corner), Offset(left, top + 14), cornerPaint)
      ..drawLine(
          Offset(left + 14, top), Offset(left + corner, top), cornerPaint)
      ..drawLine(
          Offset(right - corner, top), Offset(right - 14, top), cornerPaint)
      ..drawLine(
          Offset(right, top + 14), Offset(right, top + corner), cornerPaint)
      ..drawLine(
          Offset(left, bottom - corner), Offset(left, bottom - 14), cornerPaint)
      ..drawLine(
          Offset(left + 14, bottom), Offset(left + corner, bottom), cornerPaint)
      ..drawLine(Offset(right - corner, bottom), Offset(right - 14, bottom),
          cornerPaint)
      ..drawLine(Offset(right, bottom - corner), Offset(right, bottom - 14),
          cornerPaint);

    final centerPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = Colors.white.withValues(alpha: 0.28);
    canvas
      ..drawLine(
        Offset(selectionRect.center.dx, selectionRect.top + 12),
        Offset(selectionRect.center.dx, selectionRect.bottom - 12),
        centerPaint,
      )
      ..drawLine(
        Offset(selectionRect.left + 12, selectionRect.center.dy),
        Offset(selectionRect.right - 12, selectionRect.center.dy),
        centerPaint,
      );

    canvas.drawRect(full, Paint()..color = Colors.transparent);
  }

  @override
  bool shouldRepaint(covariant SubjectSelectionPainter oldDelegate) {
    return oldDelegate.selectionRect != selectionRect;
  }
}

class ImageSourceChooserSheet extends StatelessWidget {
  const ImageSourceChooserSheet({super.key});

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    return ClipRRect(
      borderRadius: const BorderRadius.vertical(top: Radius.circular(30)),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          padding: EdgeInsets.fromLTRB(18, 14, 18, 18 + bottomPadding),
          decoration: BoxDecoration(
            color: const Color(0xFF071735).withValues(alpha: 0.94),
            border: Border(
              top: BorderSide(color: Colors.white.withValues(alpha: 0.16)),
            ),
          ),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.30),
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                const Text(
                  '选择图片来源',
                  style: TextStyle(
                    color: Color(0xFFF4FFFC),
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  '拍一张参考图，或者从相册上传本地图片。',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.70),
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 18),
                ImageSourceOption(
                  icon: Icons.photo_camera_rounded,
                  title: '拍摄照片',
                  subtitle: '打开手机相机即时识别',
                  color: const Color(0xFF8DFFF1),
                  onTap: () => Navigator.of(context).pop(ImageSource.camera),
                ),
                const SizedBox(height: 10),
                ImageSourceOption(
                  icon: Icons.photo_library_rounded,
                  title: '上传本地图片',
                  subtitle: '从相册选择已有参考图',
                  color: const Color(0xFFFFC1E1),
                  onTap: () => Navigator.of(context).pop(ImageSource.gallery),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class ImageSourceOption extends StatelessWidget {
  const ImageSourceOption({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.10),
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: color.withValues(alpha: 0.18),
                  border: Border.all(color: color.withValues(alpha: 0.42)),
                ),
                child: Icon(icon, color: color, size: 24),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Color(0xFFF4FFFC),
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.68),
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.arrow_forward_ios_rounded,
                color: Colors.white.withValues(alpha: 0.48),
                size: 16,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class HomeSearchDock extends StatefulWidget {
  const HomeSearchDock({
    required this.controller,
    required this.focusNode,
    required this.isListening,
    required this.isPicking,
    required this.onSubmit,
    required this.onCameraPressed,
    required this.onVoicePressed,
    super.key,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool isListening;
  final bool isPicking;
  final VoidCallback onSubmit;
  final VoidCallback onCameraPressed;
  final VoidCallback onVoicePressed;

  @override
  State<HomeSearchDock> createState() => _HomeSearchDockState();
}

class _HomeSearchDockState extends State<HomeSearchDock>
    with SingleTickerProviderStateMixin {
  late final AnimationController _flow;

  @override
  void initState() {
    super.initState();
    _flow = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 5),
    )..repeat();
    widget.focusNode.addListener(_handleFocusChange);
  }

  @override
  void didUpdateWidget(covariant HomeSearchDock oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.focusNode != widget.focusNode) {
      oldWidget.focusNode.removeListener(_handleFocusChange);
      widget.focusNode.addListener(_handleFocusChange);
    }
  }

  @override
  void dispose() {
    widget.focusNode.removeListener(_handleFocusChange);
    _flow.dispose();
    super.dispose();
  }

  void _handleFocusChange() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _flow,
      builder: (context, child) {
        return CustomPaint(
          painter: SearchDockBorderPainter(
            progress: _flow.value,
            active: widget.focusNode.hasFocus,
          ),
          child: child,
        );
      },
      child: ClipRRect(
        borderRadius: BorderRadius.circular(30),
        child: BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: 22, sigmaY: 22),
          child: Container(
            constraints: const BoxConstraints(minHeight: 188),
            padding: const EdgeInsets.fromLTRB(20, 18, 16, 16),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  const Color(0xFF303B72).withValues(alpha: 0.72),
                  const Color(0xFF111423).withValues(alpha: 0.88),
                  const Color(0xFF2D275E).withValues(alpha: 0.76),
                ],
              ),
              borderRadius: BorderRadius.circular(30),
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.14),
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.48),
                  blurRadius: 42,
                  offset: const Offset(0, 22),
                ),
                BoxShadow(
                  color: const Color(0xFF675DFF).withValues(alpha: 0.34),
                  blurRadius: 64,
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  height: 92,
                  child: TextField(
                    controller: widget.controller,
                    focusNode: widget.focusNode,
                    minLines: 2,
                    maxLines: 3,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => widget.onSubmit(),
                    style: const TextStyle(
                      color: Color(0xFFF7F8FF),
                      fontSize: 17,
                      height: 1.34,
                      fontWeight: FontWeight.w700,
                    ),
                    decoration: InputDecoration(
                      hintText: '',
                      hintStyle: TextStyle(
                        color: Colors.white.withValues(alpha: 0.42),
                        fontWeight: FontWeight.w700,
                      ),
                      border: InputBorder.none,
                      isDense: true,
                    ),
                  ),
                ),
                Container(
                  height: 1,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        Colors.white.withValues(alpha: 0),
                        Colors.white.withValues(alpha: 0.12),
                        const Color(0xFF6B56FF).withValues(alpha: 0.28),
                        Colors.white.withValues(alpha: 0),
                      ],
                    ),
                  ),
                ),
                Row(
                  children: [
                    HomeSearchActionButton(
                      tooltip: '拍照或上传图片',
                      icon: Icons.photo_camera_rounded,
                      isLoading: widget.isPicking,
                      onPressed:
                          widget.isPicking ? null : widget.onCameraPressed,
                    ),
                    const Spacer(),
                    HomeSearchActionButton(
                      tooltip: '语音搜索',
                      icon: widget.isListening
                          ? Icons.graphic_eq_rounded
                          : Icons.mic_rounded,
                      isActive: widget.isListening,
                      onPressed:
                          widget.isListening ? null : widget.onVoicePressed,
                    ),
                    HomeSearchActionButton(
                      tooltip: '提交搜索',
                      icon: Icons.arrow_upward_rounded,
                      isPrimary: true,
                      onPressed: widget.onSubmit,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class HomeSearchActionButton extends StatelessWidget {
  const HomeSearchActionButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
    this.isPrimary = false,
    this.isActive = false,
    this.isLoading = false,
    super.key,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback? onPressed;
  final bool isPrimary;
  final bool isActive;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    final foreground =
        isPrimary ? const Color(0xFFF7FAFF) : const Color(0xFFEAF2FF);
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Tooltip(
        message: tooltip,
        child: Material(
          color: Colors.transparent,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onPressed,
            child: Ink(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: isPrimary || isActive
                    ? const LinearGradient(
                        colors: [
                          Color(0xFF006BFF),
                          Color(0xFF5147FF),
                          Color(0xFF8A5BFF),
                        ],
                      )
                    : null,
                color: isPrimary || isActive
                    ? null
                    : Colors.white.withValues(alpha: 0.10),
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.16),
                ),
              ),
              child: Center(
                child: isLoading
                    ? SizedBox(
                        width: 17,
                        height: 17,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: foreground,
                        ),
                      )
                    : Icon(icon, size: 20, color: foreground),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class HomeSearchModeChip extends StatelessWidget {
  const HomeSearchModeChip({
    required this.icon,
    required this.label,
    super.key,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: 0.10)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: Colors.white.withValues(alpha: 0.64)),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.72),
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class SearchDockBorderPainter extends CustomPainter {
  SearchDockBorderPainter({
    required this.progress,
    required this.active,
  });

  final double progress;
  final bool active;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = RRect.fromRectAndRadius(
      rect.deflate(2),
      const Radius.circular(30),
    );
    final colors = [
      const Color(0xFF24E8FF).withValues(alpha: active ? 0.72 : 0.42),
      const Color(0xFF5961FF).withValues(alpha: active ? 0.86 : 0.56),
      const Color(0xFF9B6DFF).withValues(alpha: active ? 0.74 : 0.46),
      const Color(0xFF24E8FF).withValues(alpha: active ? 0.72 : 0.42),
    ];

    final glow = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = active ? 9 : 7
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 16)
      ..shader = SweepGradient(
        colors: colors,
        transform: GradientRotation(progress * 2 * pi),
      ).createShader(rect);
    canvas.drawRRect(rrect, glow);

    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = active ? 1.6 : 1.1
      ..shader = SweepGradient(
        colors: colors,
        transform: GradientRotation((progress + 0.18) * 2 * pi),
      ).createShader(rect);
    canvas.drawRRect(rrect, stroke);
  }

  @override
  bool shouldRepaint(covariant SearchDockBorderPainter oldDelegate) {
    return oldDelegate.progress != progress || oldDelegate.active != active;
  }
}

class HomeHistoryDrawer extends StatelessWidget {
  const HomeHistoryDrawer({
    required this.onNewChat,
    super.key,
  });

  final VoidCallback onNewChat;

  static const _historyItems = [
    '白色跑鞋 500 以内',
    '通勤小白鞋对比',
    '只看有货低价',
    '黑色板鞋有货优先',
    '轻便徒步鞋推荐',
    '同款运动鞋找低价',
  ];

  @override
  Widget build(BuildContext context) {
    final drawerWidth = min(MediaQuery.sizeOf(context).width * 0.84, 336.0);
    return Drawer(
      width: drawerWidth,
      elevation: 0,
      backgroundColor: Colors.transparent,
      child: ClipRRect(
        borderRadius: const BorderRadius.horizontal(right: Radius.circular(28)),
        child: BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: 20, sigmaY: 20),
          child: Container(
            color: Colors.white.withValues(alpha: 0.94),
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const BrandMark(size: 40, radius: 13),
                        const SizedBox(width: 10),
                        const Expanded(
                          child: Text(
                            '比价助手',
                            style: TextStyle(
                              color: Color(0xFF111827),
                              fontSize: 22,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: '收起',
                          onPressed: () => Navigator.of(context).pop(),
                          icon: const Icon(
                            Icons.keyboard_double_arrow_left_rounded,
                            color: Color(0xFF2D3748),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    HomeDrawerPill(
                      icon: Icons.edit_rounded,
                      title: '新对话',
                      onTap: () {
                        Navigator.of(context).pop();
                        onNewChat();
                      },
                    ),
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF3F5F8),
                        borderRadius: BorderRadius.circular(22),
                      ),
                      child: const Row(
                        children: [
                          Icon(
                            Icons.search_rounded,
                            color: Color(0xFF4B5563),
                          ),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              '搜索历史对话',
                              style: TextStyle(
                                color: Color(0xFF4B5563),
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 26),
                    Row(
                      children: [
                        const Text(
                          '最近',
                          style: TextStyle(
                            color: Color(0xFF6B7280),
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(width: 4),
                        Icon(
                          Icons.keyboard_arrow_down_rounded,
                          color: Colors.black.withValues(alpha: 0.46),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Expanded(
                      child: ListView.builder(
                        padding: EdgeInsets.zero,
                        itemCount: _historyItems.length,
                        itemBuilder: (context, index) {
                          return HistoryConversationTile(
                            title: _historyItems[index],
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 24,
                          backgroundColor: const Color(0xFF7890A0),
                          child: Text(
                            'L',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.96),
                              fontWeight: FontWeight.w900,
                              fontSize: 20,
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Luyang',
                                style: TextStyle(
                                  color: Color(0xFF111827),
                                  fontSize: 18,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              SizedBox(height: 2),
                              Text(
                                '本地演示账号',
                                style: TextStyle(
                                  color: Color(0xFF6B7280),
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          tooltip: '设置',
                          onPressed: () {},
                          icon: const Icon(
                            Icons.settings_rounded,
                            color: Color(0xFF111827),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class HomeDrawerPill extends StatelessWidget {
  const HomeDrawerPill({
    required this.icon,
    required this.title,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String title;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFF0F0F2),
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
          child: Row(
            children: [
              Icon(icon, color: const Color(0xFF111827), size: 25),
              const SizedBox(width: 14),
              Text(
                title,
                style: const TextStyle(
                  color: Color(0xFF111827),
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class HistoryConversationTile extends StatelessWidget {
  const HistoryConversationTile({
    required this.title,
    super.key,
  });

  final String title;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: () => Navigator.of(context).pop(),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 12),
        child: Row(
          children: [
            Expanded(
              child: Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF111827),
                  fontSize: 16.5,
                  height: 1.2,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            Icon(
              Icons.more_vert_rounded,
              color: Colors.black.withValues(alpha: 0.54),
            ),
          ],
        ),
      ),
    );
  }
}

class RobotLogo extends StatelessWidget {
  const RobotLogo({this.size = 54, super.key});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(painter: RobotLogoPainter()),
    );
  }
}

class RobotLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final shortSide = min(size.width, size.height);

    final glowPaint = Paint()
      ..shader = RadialGradient(
        colors: [
          const Color(0xFF22F4FF).withValues(alpha: 0.40),
          const Color(0xFF7F6DFF).withValues(alpha: 0.16),
          const Color(0xFF020309).withValues(alpha: 0),
        ],
      ).createShader(rect.inflate(shortSide * 0.20));
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        rect.deflate(shortSide * 0.02),
        Radius.circular(shortSide * 0.34),
      ),
      glowPaint,
    );

    final badge = RRect.fromRectAndRadius(
      rect.deflate(shortSide * 0.08),
      Radius.circular(shortSide * 0.28),
    );
    final badgePaint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          Color(0xFF11182D),
          Color(0xFF090C17),
          Color(0xFF1E1638),
        ],
      ).createShader(rect);
    canvas.drawRRect(badge, badgePaint);

    final rimPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = shortSide * 0.026
      ..shader = const LinearGradient(
        colors: [
          Color(0xFF22F4FF),
          Color(0xFF7F6DFF),
          Color(0xFFFF9BE7),
        ],
      ).createShader(rect);
    canvas.drawRRect(badge, rimPaint);

    final visor = RRect.fromRectAndRadius(
      Rect.fromLTWH(
        size.width * 0.22,
        size.height * 0.33,
        size.width * 0.56,
        size.height * 0.25,
      ),
      Radius.circular(shortSide * 0.13),
    );
    final visorPaint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          Color(0xFFFFFFFF),
          Color(0xFFE9FCFF),
          Color(0xFFD8DAFF),
        ],
      ).createShader(visor.outerRect);
    canvas.drawRRect(visor, visorPaint);

    final eyePaint = Paint()..color = const Color(0xFF030713);
    canvas.drawCircle(
      Offset(size.width * 0.42, size.height * 0.455),
      shortSide * 0.038,
      eyePaint,
    );
    canvas.drawCircle(
      Offset(size.width * 0.58, size.height * 0.455),
      shortSide * 0.038,
      eyePaint,
    );

    final core = RRect.fromRectAndRadius(
      Rect.fromLTWH(
        size.width * 0.30,
        size.height * 0.66,
        size.width * 0.40,
        size.height * 0.08,
      ),
      Radius.circular(shortSide * 0.04),
    );
    canvas.drawRRect(
      core,
      Paint()
        ..shader = const LinearGradient(
          colors: [
            Color(0xFF22F4FF),
            Color(0xFF7F6DFF),
            Color(0xFFFF9BE7),
          ],
        ).createShader(core.outerRect),
    );

    final sparkPaint = Paint()
      ..color = const Color(0xFF22F4FF).withValues(alpha: 0.88)
      ..strokeWidth = shortSide * 0.018
      ..strokeCap = StrokeCap.round;
    final sparkCenter = Offset(size.width * 0.78, size.height * 0.25);
    canvas.drawLine(
      sparkCenter + Offset(-shortSide * 0.08, 0),
      sparkCenter + Offset(shortSide * 0.08, 0),
      sparkPaint,
    );
    canvas.drawLine(
      sparkCenter + Offset(0, -shortSide * 0.08),
      sparkCenter + Offset(0, shortSide * 0.08),
      sparkPaint,
    );
    canvas.drawCircle(
      Offset(size.width * 0.22, size.height * 0.74),
      shortSide * 0.025,
      Paint()..color = const Color(0xFFFF9BE7).withValues(alpha: 0.90),
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class BrandMark extends StatelessWidget {
  const BrandMark({
    required this.size,
    this.radius = 18,
    super.key,
  });

  final double size;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.30),
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Image.asset(
        'assets/images/app_mark.jpg',
        fit: BoxFit.cover,
      ),
    );
  }
}

class CaptureLaunchPanel extends StatelessWidget {
  const CaptureLaunchPanel({
    required this.isLoading,
    required this.onCameraPressed,
    required this.onGalleryPressed,
    super.key,
  });

  final bool isLoading;
  final VoidCallback onCameraPressed;
  final VoidCallback onGalleryPressed;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          const _CameraPreviewPlaceholder(),
          const SizedBox(height: 12),
          FlowCaptureButton(
            isLoading: isLoading,
            onPressed: onCameraPressed,
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: isLoading ? null : onGalleryPressed,
            icon: const Icon(Icons.image_rounded),
            label: const Text('从相册选择'),
            style: OutlinedButton.styleFrom(
              foregroundColor: const Color(0xFFEAFBF7),
              side: BorderSide(color: Colors.white.withValues(alpha: 0.18)),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(18),
              ),
              minimumSize: const Size.fromHeight(46),
            ),
          ),
        ],
      ),
    );
  }
}

class _CameraPreviewPlaceholder extends StatefulWidget {
  const _CameraPreviewPlaceholder();

  @override
  State<_CameraPreviewPlaceholder> createState() =>
      _CameraPreviewPlaceholderState();
}

class _CameraPreviewPlaceholderState extends State<_CameraPreviewPlaceholder>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 5),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: SizedBox(
        height: 196,
        width: double.infinity,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            return Stack(
              fit: StackFit.expand,
              children: [
                DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        const Color(0xFFBDFBFF).withValues(alpha: 0.18),
                        const Color(0xFF7F9DFF).withValues(alpha: 0.15),
                        const Color(0xFFFF8FC8).withValues(alpha: 0.14),
                        const Color(0xFFA9FF80).withValues(alpha: 0.12),
                        const Color(0xFF091629).withValues(alpha: 0.18),
                      ],
                      stops: const [0, 0.25, 0.52, 0.74, 1],
                    ),
                  ),
                ),
                CustomPaint(
                  painter: PhotoPortalPainter(progress: _controller.value),
                ),
                Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(
                        width: 102,
                        height: 72,
                        child: CameraOutlineMark(progress: _controller.value),
                      ),
                      const SizedBox(height: 8),
                      ShaderMask(
                        shaderCallback: (rect) => LinearGradient(
                          begin: Alignment(-1 + _controller.value * 2, -1),
                          end: Alignment(_controller.value * 2, 1),
                          colors: const [
                            Color(0xFFFFFFFF),
                            Color(0xFF8FFFF0),
                            Color(0xFFFFC1E1),
                            Color(0xFFFFE08A),
                            Color(0xFFFFFFFF),
                          ],
                        ).createShader(rect),
                        child: const Text(
                          '你想要的都能拍',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w900,
                            shadows: [
                              Shadow(
                                color: Color(0xAA071735),
                                blurRadius: 16,
                                offset: Offset(0, 5),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class PhotoPortalPainter extends CustomPainter {
  PhotoPortalPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;

    _drawRibbon(
      canvas,
      size,
      const Color(0xFF7EFFF0),
      0.10,
      0.46,
      0,
      0.22,
    );
    _drawRibbon(
      canvas,
      size,
      const Color(0xFFFF8FC8),
      0.18,
      0.58,
      0.36,
      0.16,
    );
    _drawRibbon(
      canvas,
      size,
      const Color(0xFFFFD36C),
      0.50,
      0.88,
      0.68,
      0.11,
    );

    final scanRect = Rect.fromCenter(
      center: Offset(size.width / 2, size.height / 2),
      width: size.width * 0.74,
      height: size.height * 0.62,
    );
    final framePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..shader = LinearGradient(
        begin: Alignment(-1 + progress * 2, -1),
        end: Alignment(progress * 2, 1),
        colors: [
          Colors.white.withValues(alpha: 0.14),
          const Color(0xFF92FFF1).withValues(alpha: 0.72),
          const Color(0xFFFFBFE3).withValues(alpha: 0.58),
          Colors.white.withValues(alpha: 0.14),
        ],
      ).createShader(scanRect);
    canvas.drawRRect(
      RRect.fromRectAndRadius(scanRect, const Radius.circular(30)),
      framePaint,
    );

    final cornerPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.58)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.2
      ..strokeCap = StrokeCap.round;
    const corner = 28.0;
    final left = scanRect.left + 12;
    final right = scanRect.right - 12;
    final top = scanRect.top + 12;
    final bottom = scanRect.bottom - 12;
    canvas.drawLine(Offset(left, top), Offset(left + corner, top), cornerPaint);
    canvas.drawLine(Offset(left, top), Offset(left, top + corner), cornerPaint);
    canvas.drawLine(
        Offset(right, top), Offset(right - corner, top), cornerPaint);
    canvas.drawLine(
        Offset(right, top), Offset(right, top + corner), cornerPaint);
    canvas.drawLine(
        Offset(left, bottom), Offset(left + corner, bottom), cornerPaint);
    canvas.drawLine(
        Offset(left, bottom), Offset(left, bottom - corner), cornerPaint);
    canvas.drawLine(
        Offset(right, bottom), Offset(right - corner, bottom), cornerPaint);
    canvas.drawLine(
        Offset(right, bottom), Offset(right, bottom - corner), cornerPaint);

    final local = (progress * 1.3) % 1;
    final start = Offset(size.width * (1.05 - local * 1.3), size.height * 0.18);
    final end = start + const Offset(-86, 32);
    final meteorPaint = Paint()
      ..shader = LinearGradient(
        colors: [
          Colors.white.withValues(alpha: 0),
          const Color(0xFFFFF2A8).withValues(alpha: 0.58),
          Colors.white.withValues(alpha: 0),
        ],
      ).createShader(Rect.fromPoints(start, end))
      ..strokeWidth = 1.4
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(start, end, meteorPaint);

    final shade = Paint()
      ..shader = LinearGradient(
        begin: Alignment.bottomCenter,
        end: Alignment.topCenter,
        colors: [
          const Color(0xFF071735).withValues(alpha: 0.24),
          Colors.transparent,
        ],
      ).createShader(rect);
    canvas.drawRect(rect, shade);
  }

  void _drawRibbon(
    Canvas canvas,
    Size size,
    Color color,
    double top,
    double bottom,
    double phase,
    double opacity,
  ) {
    final wave = sin((progress + phase) * 2 * pi);
    final path = Path()
      ..moveTo(-size.width * 0.06, size.height * (top + wave * 0.04))
      ..cubicTo(
        size.width * 0.25,
        size.height * (top + 0.18),
        size.width * 0.62,
        size.height * (top - 0.12 + wave * 0.05),
        size.width * 1.04,
        size.height * (top + 0.12),
      )
      ..lineTo(size.width * 1.04, size.height * bottom)
      ..cubicTo(
        size.width * 0.72,
        size.height * (bottom - 0.10),
        size.width * 0.32,
        size.height * (bottom + 0.08 - wave * 0.04),
        -size.width * 0.06,
        size.height * (bottom - 0.07),
      )
      ..close();
    final paint = Paint()
      ..color = color.withValues(alpha: opacity)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 28);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant PhotoPortalPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class CameraOutlineMark extends StatelessWidget {
  const CameraOutlineMark({required this.progress, super.key});

  final double progress;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(painter: CameraOutlinePainter(progress: progress));
  }
}

class CameraOutlinePainter extends CustomPainter {
  CameraOutlinePainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final body = Rect.fromLTWH(
      size.width * 0.12,
      size.height * 0.26,
      size.width * 0.76,
      size.height * 0.52,
    );
    final bodyRRect = RRect.fromRectAndRadius(
      body,
      Radius.circular(size.height * 0.16),
    );
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.2
      ..shader = LinearGradient(
        begin: Alignment(-1 + progress * 2, -1),
        end: Alignment(progress * 2, 1),
        colors: const [
          Color(0xFFFFFFFF),
          Color(0xFF8FFFF0),
          Color(0xFFFFB8DF),
          Color(0xFFFFE18A),
          Color(0xFFFFFFFF),
        ],
      ).createShader(body);
    canvas.drawRRect(bodyRRect, stroke);

    final top = RRect.fromRectAndRadius(
      Rect.fromLTWH(
        size.width * 0.33,
        size.height * 0.16,
        size.width * 0.24,
        size.height * 0.18,
      ),
      Radius.circular(size.height * 0.07),
    );
    canvas.drawRRect(top, stroke);

    final lensCenter = Offset(size.width * 0.50, size.height * 0.52);
    final lensPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..color = const Color(0xFFEFFFFB).withValues(alpha: 0.86);
    canvas.drawCircle(lensCenter, size.height * 0.16, lensPaint);
    canvas.drawCircle(
      lensCenter,
      size.height * (0.055 + 0.012 * sin(progress * 2 * pi)),
      Paint()..color = const Color(0xFF8FFFF0).withValues(alpha: 0.82),
    );

    final flashPaint = Paint()
      ..color = const Color(0xFFFFD982).withValues(alpha: 0.90);
    canvas.drawCircle(
      Offset(size.width * 0.72, size.height * 0.40),
      size.height * 0.035,
      flashPaint,
    );
  }

  @override
  bool shouldRepaint(covariant CameraOutlinePainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class FlowCaptureButton extends StatefulWidget {
  const FlowCaptureButton({
    required this.isLoading,
    required this.onPressed,
    super.key,
  });

  final bool isLoading;
  final VoidCallback onPressed;

  @override
  State<FlowCaptureButton> createState() => _FlowCaptureButtonState();
}

class _FlowCaptureButtonState extends State<FlowCaptureButton>
    with TickerProviderStateMixin {
  late final AnimationController _flow;
  late final AnimationController _burst;

  @override
  void initState() {
    super.initState();
    _flow = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 3),
    )..repeat();
    _burst = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 520),
    );
  }

  @override
  void dispose() {
    _flow.dispose();
    _burst.dispose();
    super.dispose();
  }

  void _handleTap() {
    if (widget.isLoading) return;
    _burst.forward(from: 0);
    widget.onPressed();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 58,
      child: AnimatedBuilder(
        animation: Listenable.merge([_flow, _burst]),
        builder: (context, child) {
          return CustomPaint(
            painter: ButtonLightPainter(
              flow: _flow.value,
              burst: _burst.value,
            ),
            child: child,
          );
        },
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(22),
          child: InkWell(
            borderRadius: BorderRadius.circular(22),
            onTap: _handleTap,
            child: Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  widget.isLoading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Color(0xFF031614),
                          ),
                        )
                      : const Icon(
                          Icons.photo_camera_rounded,
                          color: Color(0xFF031614),
                        ),
                  const SizedBox(width: 10),
                  Text(
                    widget.isLoading ? '正在打开相机...' : '拍照检索',
                    style: const TextStyle(
                      color: Color(0xFF031614),
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class ButtonLightPainter extends CustomPainter {
  ButtonLightPainter({required this.flow, required this.burst});

  final double flow;
  final double burst;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = RRect.fromRectAndRadius(rect, const Radius.circular(22));
    final paint = Paint()
      ..shader = LinearGradient(
        begin: Alignment(-1 + flow * 2, -1),
        end: Alignment(flow * 2, 1),
        colors: const [
          Color(0xFF8DFFF1),
          Color(0xFF87B8FF),
          Color(0xFFFF8FC8),
          Color(0xFFFFD36C),
          Color(0xFFA6FF80),
          Color(0xFF8DFFF1),
        ],
      ).createShader(rect);
    canvas.drawRRect(rrect, paint);

    final shine = Paint()
      ..shader = LinearGradient(
        colors: [
          Colors.white.withValues(alpha: 0),
          Colors.white.withValues(alpha: 0.46),
          Colors.white.withValues(alpha: 0),
        ],
      ).createShader(
        Rect.fromLTWH(
            size.width * (flow - 0.35), 0, size.width * 0.45, size.height),
      );
    canvas.save();
    canvas.clipRRect(rrect);
    canvas.translate(size.width * (flow * 1.4 - 0.25), 0);
    canvas.rotate(-0.22);
    canvas.drawRect(
      Rect.fromLTWH(-12, -size.height, size.width * 0.22, size.height * 3),
      shine,
    );
    canvas.restore();

    canvas.save();
    canvas.clipRRect(rrect);
    for (var i = 0; i < 3; i += 1) {
      final local = (flow + i * 0.32) % 1;
      final fade = sin(local * pi).clamp(0.0, 1.0).toDouble();
      final start = Offset(
        size.width * (1.10 - local * 1.34),
        size.height * (0.20 + i * 0.22),
      );
      final end = start + Offset(-44 - i * 5, 13 + i * 4);
      final cometPaint = Paint()
        ..shader = LinearGradient(
          colors: [
            Colors.white.withValues(alpha: 0),
            Colors.white.withValues(alpha: 0.54 * fade),
            Colors.white.withValues(alpha: 0),
          ],
        ).createShader(Rect.fromPoints(start, end))
        ..strokeWidth = 1.15
        ..strokeCap = StrokeCap.round;
      canvas.drawLine(start, end, cometPaint);
      canvas.drawCircle(
        start,
        1.25,
        Paint()..color = Colors.white.withValues(alpha: 0.56 * fade),
      );
    }
    canvas.restore();

    if (burst > 0 && burst < 1) {
      final burstPaint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = Colors.white.withValues(alpha: (1 - burst) * 0.45);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          rect.inflate(12 * burst),
          Radius.circular(22 + 12 * burst),
        ),
        burstPaint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant ButtonLightPainter oldDelegate) {
    return oldDelegate.flow != flow || oldDelegate.burst != burst;
  }
}

class _ResultTopBar extends StatelessWidget {
  const _ResultTopBar({
    required this.title,
    required this.onBack,
    required this.cartCount,
    required this.onCartPressed,
  });

  final String title;
  final VoidCallback onBack;
  final int cartCount;
  final VoidCallback onCartPressed;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        GlassIconButton(icon: Icons.arrow_back_rounded, onPressed: onBack),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            title,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
          ),
        ),
        SessionCartIconButton(
          count: cartCount,
          onTap: onCartPressed,
          elevated: true,
        ),
        const SizedBox(width: 10),
        const RobotLogo(size: 42),
      ],
    );
  }
}

class VoiceCommandPanel extends StatelessWidget {
  const VoiceCommandPanel({
    required this.isListening,
    required this.title,
    required this.subtitle,
    required this.onPressed,
    this.compact = false,
    super.key,
  });

  final bool isListening;
  final String title;
  final String subtitle;
  final VoidCallback onPressed;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      padding:
          EdgeInsets.fromLTRB(14, compact ? 10 : 12, 14, compact ? 10 : 12),
      child: Row(
        children: [
          VoiceInputButton(
            isListening: isListening,
            onPressed: onPressed,
            size: compact ? 50 : 62,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isListening ? '正在听你描述...' : title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: compact
                        ? const Color(0xFFFDF7EC)
                        : const Color(0xFFEFFFFB),
                    fontSize: compact ? 14.5 : 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  maxLines: compact ? 1 : 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.72),
                    fontSize: compact ? 11.5 : 12.5,
                    height: 1.24,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Icon(
            Icons.arrow_forward_rounded,
            color: Colors.white.withValues(alpha: 0.70),
            size: 20,
          ),
        ],
      ),
    );
  }
}

class PromptDock extends StatelessWidget {
  const PromptDock({
    required this.controller,
    required this.hintText,
    this.focusNode,
    this.onSubmit,
    this.onVoicePressed,
    this.isListening = false,
    this.prominent = false,
    super.key,
  });

  final TextEditingController controller;
  final String hintText;
  final FocusNode? focusNode;
  final VoidCallback? onSubmit;
  final VoidCallback? onVoicePressed;
  final bool isListening;
  final bool prominent;

  @override
  Widget build(BuildContext context) {
    final textField = TextField(
      controller: controller,
      focusNode: focusNode,
      minLines: prominent ? 2 : 1,
      maxLines: prominent ? 4 : 3,
      textInputAction:
          onSubmit == null ? TextInputAction.done : TextInputAction.send,
      onSubmitted: (_) => onSubmit?.call(),
      style: TextStyle(
        color: prominent ? const Color(0xFF16253B) : Colors.white,
        fontSize: prominent ? 16.5 : 15,
        height: 1.32,
        fontWeight: FontWeight.w700,
      ),
      decoration: InputDecoration(
        hintText: hintText,
        hintStyle: TextStyle(
          color: prominent ? const Color(0xFF68778B) : const Color(0xFFA9C7C1),
        ),
        border: InputBorder.none,
        isDense: true,
      ),
    );

    if (prominent) {
      return Container(
        constraints: const BoxConstraints(minHeight: 104),
        padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.90),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: Colors.white.withValues(alpha: 0.65)),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFF0A1330).withValues(alpha: 0.20),
              blurRadius: 30,
              offset: const Offset(0, 18),
            ),
            BoxShadow(
              color: const Color(0xFF8DFFF1).withValues(alpha: 0.12),
              blurRadius: 26,
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: const Color(0xFFEBF7FF),
                border: Border.all(color: const Color(0xFFD8ECFF)),
              ),
              child: const Icon(
                Icons.chat_bubble_rounded,
                color: Color(0xFF34618A),
                size: 21,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(child: textField),
            const SizedBox(width: 10),
            if (onVoicePressed != null)
              VoiceInputButton(
                isListening: isListening,
                onPressed: onVoicePressed!,
              ),
            if (onSubmit != null) ...[
              const SizedBox(width: 8),
              SubmitPromptButton(
                onPressed: onSubmit!,
                compact: false,
              ),
            ],
          ],
        ),
      );
    }

    return GlassPanel(
      padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
      child: Row(
        children: [
          const Icon(Icons.chat_bubble_rounded, color: Color(0xFF95FFE0)),
          const SizedBox(width: 10),
          Expanded(child: textField),
          const SizedBox(width: 8),
          if (onVoicePressed != null)
            VoiceInputButton(
              isListening: isListening,
              onPressed: onVoicePressed!,
            ),
          if (onSubmit != null)
            SubmitPromptButton(
              onPressed: onSubmit!,
              compact: true,
            ),
        ],
      ),
    );
  }
}

class SubmitPromptButton extends StatelessWidget {
  const SubmitPromptButton({
    required this.onPressed,
    required this.compact,
    super.key,
  });

  final VoidCallback onPressed;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF89FFE3),
      borderRadius: BorderRadius.circular(compact ? 18 : 22),
      child: InkWell(
        borderRadius: BorderRadius.circular(compact ? 18 : 22),
        onTap: onPressed,
        child: SizedBox(
          height: compact ? 44 : 54,
          width: compact ? 72 : 78,
          child: const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.send_rounded,
                color: Color(0xFF031614),
                size: 17,
              ),
              SizedBox(width: 4),
              Text(
                '提交',
                style: TextStyle(
                  color: Color(0xFF031614),
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class VoiceInputButton extends StatefulWidget {
  const VoiceInputButton({
    required this.onPressed,
    this.isListening = false,
    this.size = 60,
    super.key,
  });

  final VoidCallback onPressed;
  final bool isListening;
  final double size;

  @override
  State<VoiceInputButton> createState() => _VoiceInputButtonState();
}

class _VoiceInputButtonState extends State<VoiceInputButton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat();
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: AnimatedBuilder(
        animation: _pulse,
        builder: (context, child) {
          return CustomPaint(
            painter: VoicePulsePainter(
              progress: _pulse.value,
              isListening: widget.isListening,
            ),
            child: child,
          );
        },
        child: Material(
          color: Colors.transparent,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: widget.onPressed,
            child: Center(
              child: Icon(
                widget.isListening
                    ? Icons.graphic_eq_rounded
                    : Icons.mic_rounded,
                color: const Color(0xFF0E2439),
                size: widget.isListening ? 32 : 30,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class VoicePulsePainter extends CustomPainter {
  VoicePulsePainter({required this.progress, required this.isListening});

  final double progress;
  final bool isListening;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final center = rect.center;
    final radius = min(size.width, size.height) / 2;
    final activePulse =
        isListening ? (0.34 + 0.20 * sin(progress * 2 * pi)) : 0.22;

    final halo = Paint()
      ..color = const Color(0xFF8DFFF1).withValues(
        alpha: activePulse * (1 - progress * 0.45),
      );
    canvas.drawCircle(center, radius * (0.78 + progress * 0.28), halo);

    final button = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          const Color(0xFFFFF1C7),
          const Color(0xFF8DFFF1),
          isListening ? const Color(0xFFFF8FC8) : const Color(0xFFA8B7FF),
        ],
      ).createShader(rect);
    canvas.drawCircle(center, radius * 0.74, button);

    final shine = Paint()
      ..shader = RadialGradient(
        center: const Alignment(-0.45, -0.55),
        radius: 0.8,
        colors: [
          Colors.white.withValues(alpha: 0.64),
          Colors.white.withValues(alpha: 0),
        ],
      ).createShader(rect);
    canvas.drawCircle(center, radius * 0.74, shine);
  }

  @override
  bool shouldRepaint(covariant VoicePulsePainter oldDelegate) {
    return oldDelegate.progress != progress ||
        oldDelegate.isListening != isListening;
  }
}

class QuickPromptRow extends StatelessWidget {
  const QuickPromptRow({required this.onSelected, super.key});

  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    const prompts = ['500以内', '只看有货', '先看最低价'];
    return Wrap(
      spacing: 7,
      runSpacing: 7,
      children: [
        for (final prompt in prompts)
          ActionChip(
            avatar: const Icon(
              Icons.auto_awesome_rounded,
              size: 13,
              color: Color(0xFFE6B95D),
            ),
            label: Text(prompt),
            onPressed: () => onSelected(prompt),
            visualDensity: VisualDensity.compact,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            labelPadding: const EdgeInsets.only(right: 4),
            backgroundColor: const Color(0xFFFFE7A8).withValues(alpha: 0.16),
            side: BorderSide(
              color: const Color(0xFFFFE7A8).withValues(alpha: 0.32),
            ),
            labelStyle: const TextStyle(
              color: Color(0xFFFFE7A8),
              fontSize: 11.5,
              fontWeight: FontWeight.w800,
            ),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
      ],
    );
  }
}

String productSearchPipelineModeLabel(ProductSearchPipelineMode mode) {
  return switch (mode) {
    ProductSearchPipelineMode.currentAnnThenRefine => '当前 ANN 快速预览 + 标签 refine',
    ProductSearchPipelineMode.lightTagAnnFusion => '轻量标签 + ANN 融合 TopK',
  };
}

String productSearchPipelineModeStatus(ProductSearchPipelineMode mode) {
  return switch (mode) {
    ProductSearchPipelineMode.currentAnnThenRefine => '当前先展示相似款预览，识别完成后可刷新正式推荐',
    ProductSearchPipelineMode.lightTagAnnFusion => '已根据轻量标签和视觉相似度综合推荐',
  };
}

class ProductSearchProfilePanel extends StatelessWidget {
  const ProductSearchProfilePanel({
    required this.profile,
    required this.pipelineMode,
    required this.isSaving,
    required this.onEdit,
    required this.onModeChanged,
    super.key,
  });

  final BackendProductProfile? profile;
  final ProductSearchPipelineMode pipelineMode;
  final bool isSaving;
  final VoidCallback onEdit;
  final ValueChanged<ProductSearchPipelineMode> onModeChanged;

  @override
  Widget build(BuildContext context) {
    final tags = profile?.searchTags ?? const <String>[];
    return GlassPanel(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.sell_rounded, color: Color(0xFF89FFE3)),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  '用于搜索的识别标签',
                  style: TextStyle(
                    color: Color(0xFFF4FFFD),
                    fontSize: 14.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              TextButton.icon(
                onPressed: isSaving ? null : onEdit,
                icon: isSaving
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.edit_rounded, size: 16),
                label: const Text('修改'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SegmentedButton<ProductSearchPipelineMode>(
            showSelectedIcon: false,
            segments: const [
              ButtonSegment(
                value: ProductSearchPipelineMode.currentAnnThenRefine,
                icon: Icon(Icons.flash_on_rounded, size: 16),
                label: Text('当前链路'),
              ),
              ButtonSegment(
                value: ProductSearchPipelineMode.lightTagAnnFusion,
                icon: Icon(Icons.merge_type_rounded, size: 16),
                label: Text('方案二'),
              ),
            ],
            selected: {pipelineMode},
            onSelectionChanged:
                isSaving ? null : (values) => onModeChanged(values.first),
          ),
          const SizedBox(height: 8),
          Text(
            productSearchPipelineModeStatus(pipelineMode),
            style: const TextStyle(
              color: Color(0xFFC5E4DF),
              fontSize: 12,
              height: 1.35,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 10),
          if (tags.isEmpty)
            const Text(
              '正在识别商品属性，当前先用视觉相似度检索。',
              style: TextStyle(
                color: Color(0xFFD6F3ED),
                fontSize: 12.5,
                height: 1.35,
              ),
            )
          else
            Wrap(
              spacing: 7,
              runSpacing: 7,
              children: [
                for (final tag in tags.take(12))
                  _SoftChip(
                    icon: Icons.auto_awesome_rounded,
                    label: tag,
                    color: const Color(0xFF8BFFD9),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

class ProductProfileEditSheet extends StatefulWidget {
  const ProductProfileEditSheet({required this.profile, super.key});

  final BackendProductProfile profile;

  @override
  State<ProductProfileEditSheet> createState() =>
      _ProductProfileEditSheetState();
}

class _ProductProfileEditSheetState extends State<ProductProfileEditSheet> {
  late final TextEditingController _brandController;
  late final TextEditingController _colorController;
  late final TextEditingController _shoeTypeController;

  @override
  void initState() {
    super.initState();
    final profile = widget.profile;
    _brandController = TextEditingController(text: profile.brand ?? '');
    _colorController = TextEditingController(
      text: profile.color ?? profile.colorway ?? profile.colorFamily ?? '',
    );
    _shoeTypeController = TextEditingController(
      text: profile.category == 'shoe'
          ? profile.shoeType ?? ''
          : profile.modelLine ?? profile.category,
    );
  }

  @override
  void dispose() {
    _brandController.dispose();
    _colorController.dispose();
    _shoeTypeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).viewInsets.bottom +
        MediaQuery.of(context).padding.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(12, 0, 12, 12 + bottomPadding),
      child: GlassPanel(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.tune_rounded, color: Color(0xFF89FFE3)),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    '修改搜索标签',
                    style: TextStyle(
                      color: Color(0xFFF4FFFD),
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            const SizedBox(height: 8),
            _ProfileEditField(label: '品牌', controller: _brandController),
            _ProfileEditField(
              label: widget.profile.category == 'shoe' ? '颜色' : '主色',
              controller: _colorController,
            ),
            if (widget.profile.category == 'shoe')
              _ProfileEditField(label: '鞋型', controller: _shoeTypeController)
            else
              _ProfileEditField(
                  label: '品类/型号', controller: _shoeTypeController),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _submit,
                icon: const Icon(Icons.check_rounded),
                label: const Text('保存并重新搜索'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _submit() {
    final color = _colorController.text;
    final type = _shoeTypeController.text;
    final updated = widget.profile.copyWith(
      brand: _brandController.text,
      modelLine: widget.profile.category == 'shoe' ? null : type,
      colorFamily: color,
      color: color,
      colorway: null,
      shoeType: widget.profile.category == 'shoe' ? type : null,
      styleTags: const [],
      sceneTags: const [],
      keywords: const [],
      confidence: 1,
    );
    Navigator.of(context).pop(updated);
  }
}

class _ProfileEditField extends StatelessWidget {
  const _ProfileEditField({
    required this.label,
    required this.controller,
  });

  final String label;
  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: TextField(
        controller: controller,
        style: const TextStyle(
          color: Color(0xFFF4FFFD),
          fontWeight: FontWeight.w700,
        ),
        decoration: InputDecoration(
          labelText: label,
          labelStyle: const TextStyle(color: Color(0xFFC5E4DF)),
          filled: true,
          fillColor: Colors.white.withValues(alpha: 0.08),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: BorderSide(
              color: Colors.white.withValues(alpha: 0.14),
            ),
          ),
        ),
      ),
    );
  }
}

class ResultAssistantRecommendations extends StatelessWidget {
  const ResultAssistantRecommendations({
    required this.imageFile,
    required this.onPromptSelected,
    super.key,
  });

  final File? imageFile;
  final ValueChanged<String> onPromptSelected;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const RobotLogo(size: 40),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  imageFile == null
                      ? '我会按你的语音描述先找候选，也顺手给出搭配建议。'
                      : '我先给你找同款，也顺手挑了几条穿搭灵感。',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.94),
                    fontSize: 13.5,
                    height: 1.28,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 102,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemBuilder: (context, index) => StyleRecommendationCard(
                recommendation: styleRecommendations[index],
                imageFile: index == 0 ? imageFile : null,
                onTap: () =>
                    onPromptSelected(styleRecommendations[index].prompt),
              ),
              separatorBuilder: (_, __) => const SizedBox(width: 10),
              itemCount: styleRecommendations.length,
            ),
          ),
        ],
      ),
    );
  }
}

class ShoeRequiredInfoPanel extends StatelessWidget {
  const ShoeRequiredInfoPanel({
    required this.selectedSize,
    required this.onSizeChanged,
    super.key,
  });

  final String? selectedSize;
  final ValueChanged<String?> onSizeChanged;

  static const shoeSizes = [
    '35',
    '36',
    '37',
    '38',
    '39',
    '40',
    '41',
    '42',
    '43',
    '44',
    '45',
    '46',
  ];

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: const Color(0xFFFFE7A8).withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: const Color(0xFFFFE7A8).withValues(alpha: 0.28),
              ),
            ),
            child: const Icon(
              Icons.straighten_rounded,
              color: Color(0xFFFFE7A8),
              size: 22,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '必备信息',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 3),
                Text(
                  selectedSize == null
                      ? '先选择鞋码，后续会默认带入'
                      : '默认鞋码 $selectedSize，可随时修改',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.68),
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 92,
            child: DropdownButtonFormField<String>(
              initialValue: selectedSize,
              hint: const Text('鞋码'),
              isDense: true,
              dropdownColor: const Color(0xFF302645),
              iconEnabledColor: const Color(0xFFFFE7A8),
              style: const TextStyle(
                color: Color(0xFFFFF6D8),
                fontWeight: FontWeight.w900,
              ),
              decoration: InputDecoration(
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
                filled: true,
                fillColor: Colors.white.withValues(alpha: 0.10),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(15),
                  borderSide: BorderSide(
                    color: const Color(0xFFFFE7A8).withValues(alpha: 0.28),
                  ),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(15),
                  borderSide: BorderSide(
                    color: const Color(0xFFFFE7A8).withValues(alpha: 0.28),
                  ),
                ),
              ),
              items: [
                for (final size in shoeSizes)
                  DropdownMenuItem(value: size, child: Text('$size 码')),
              ],
              onChanged: onSizeChanged,
            ),
          ),
        ],
      ),
    );
  }
}

class ProductListToolbar extends StatelessWidget {
  const ProductListToolbar({
    required this.sortMode,
    required this.filterSpec,
    required this.onSortPressed,
    required this.onPlatformPressed,
    required this.onFilterPressed,
    super.key,
  });

  final CandidateSortMode sortMode;
  final MvpFilterSpec filterSpec;
  final VoidCallback onSortPressed;
  final VoidCallback onPlatformPressed;
  final VoidCallback onFilterPressed;

  @override
  Widget build(BuildContext context) {
    final hint = switch (sortMode) {
      CandidateSortMode.match => '默认承接后端相似度排序，最像的先出现',
      CandidateSortMode.price => '已由前端按价格从低到高重排',
      CandidateSortMode.priceHigh => '已由前端按价格从高到低重排',
      CandidateSortMode.rating => '已由前端按评分从高到低重排',
      CandidateSortMode.delivery => '已由前端按预计送达时间重排',
    };

    return GlassPanel(
      padding: const EdgeInsets.fromLTRB(10, 10, 10, 9),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                ResultFilterButton(
                  icon: Icons.place_rounded,
                  label: '附近',
                  value: '当前城市',
                  active: false,
                  onPressed: () {},
                ),
                const SizedBox(width: 8),
                ResultFilterButton(
                  icon: Icons.storefront_rounded,
                  label: filterSpec.platform == null
                      ? '全部平台'
                      : platformDisplayName(filterSpec.platform!),
                  active: filterSpec.platform != null,
                  onPressed: onPlatformPressed,
                ),
                const SizedBox(width: 8),
                ResultFilterButton(
                  icon: sortMode.icon,
                  label: sortMode == CandidateSortMode.match
                      ? '智能排序'
                      : '${sortMode.label}优先',
                  active: sortMode != CandidateSortMode.match,
                  onPressed: onSortPressed,
                ),
                const SizedBox(width: 8),
                ResultFilterButton(
                  icon: Icons.filter_alt_rounded,
                  label: filterSpec.activeCount == 0
                      ? '筛选'
                      : '筛选 ${filterSpec.activeCount}',
                  active: filterSpec.activeCount > 0,
                  onPressed: onFilterPressed,
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            hint,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.66),
              fontSize: 11.5,
              height: 1.25,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (filterSpec.labels.length > 1) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final label in filterSpec.labels.skip(1))
                  _MiniTag(icon: Icons.check_rounded, label: label),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class ResultFilterButton extends StatelessWidget {
  const ResultFilterButton({
    required this.icon,
    required this.label,
    required this.active,
    required this.onPressed,
    this.value,
    super.key,
  });

  final IconData icon;
  final String label;
  final String? value;
  final bool active;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final color = active ? const Color(0xFFFF7A2F) : Colors.white;
    return Material(
      color: active
          ? const Color(0xFFFF7A2F).withValues(alpha: 0.15)
          : Colors.white.withValues(alpha: 0.09),
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(15),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: active
                  ? const Color(0xFFFF7A2F).withValues(alpha: 0.55)
                  : Colors.white.withValues(alpha: 0.14),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 5),
              Text(
                value == null ? label : '$label $value',
                style: TextStyle(
                  color: color,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(width: 2),
              Icon(Icons.keyboard_arrow_down_rounded, size: 16, color: color),
            ],
          ),
        ),
      ),
    );
  }
}

class SortModeSheet extends StatelessWidget {
  const SortModeSheet({required this.current, super.key});

  final CandidateSortMode current;

  @override
  Widget build(BuildContext context) {
    final options = [
      CandidateSortMode.match,
      CandidateSortMode.price,
      CandidateSortMode.priceHigh,
      CandidateSortMode.rating,
      CandidateSortMode.delivery,
    ];
    return FilterBottomSheetFrame(
      title: '智能排序',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final mode in options)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                mode.icon,
                color: mode == current
                    ? const Color(0xFFFF7A2F)
                    : Colors.white.withValues(alpha: 0.72),
              ),
              title: Text(_sortSheetTitle(mode)),
              subtitle: Text(
                _sortSheetSubtitle(mode),
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.55),
                  fontSize: 12,
                ),
              ),
              trailing: mode == current
                  ? const Icon(Icons.check_circle_rounded,
                      color: Color(0xFFFF7A2F))
                  : null,
              onTap: () => Navigator.of(context).pop(mode),
            ),
        ],
      ),
    );
  }

  String _sortSheetTitle(CandidateSortMode mode) {
    return switch (mode) {
      CandidateSortMode.match => '相似度优先',
      CandidateSortMode.price => '低价优先',
      CandidateSortMode.priceHigh => '高价优先',
      CandidateSortMode.rating => '好评优先',
      CandidateSortMode.delivery => '送达优先',
    };
  }

  String _sortSheetSubtitle(CandidateSortMode mode) {
    return switch (mode) {
      CandidateSortMode.match => '沿用后端标签 + 图像检索排序',
      CandidateSortMode.price => '前端按价格从低到高重排',
      CandidateSortMode.priceHigh => '前端按价格从高到低重排',
      CandidateSortMode.rating => '优先展示评分更高的商品',
      CandidateSortMode.delivery => '优先展示预计更快送达的商品',
    };
  }
}

class PlatformFilterSheet extends StatelessWidget {
  const PlatformFilterSheet({required this.current, super.key});

  final String? current;

  @override
  Widget build(BuildContext context) {
    const platforms = ['taobao', 'tmall', 'jd', 'dewu', 'pdd', 'douyin'];
    return FilterBottomSheetFrame(
      title: '选择平台',
      child: Wrap(
        spacing: 10,
        runSpacing: 10,
        children: [
          PlatformChoiceTile(
            platform: null,
            label: '全部平台',
            selected: current == null,
            onTap: () => Navigator.of(context).pop('__clear__'),
          ),
          for (final platform in platforms)
            PlatformChoiceTile(
              platform: platform,
              label: platformDisplayName(platform),
              selected: current == platform,
              onTap: () => Navigator.of(context).pop(platform),
            ),
        ],
      ),
    );
  }
}

class PlatformChoiceTile extends StatelessWidget {
  const PlatformChoiceTile({
    required this.platform,
    required this.label,
    required this.selected,
    required this.onTap,
    super.key,
  });

  final String? platform;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final accent = platform == null
        ? const Color(0xFFFF7A2F)
        : platformAccentColor(platform!);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        width: 104,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        decoration: BoxDecoration(
          color: selected
              ? accent.withValues(alpha: 0.18)
              : Colors.white.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: selected
                ? accent.withValues(alpha: 0.65)
                : Colors.white.withValues(alpha: 0.12),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (platform == null)
              Icon(Icons.all_inclusive_rounded, size: 20, color: accent)
            else
              PlatformLogoBadge(platform: platform!, size: 22),
            const SizedBox(width: 7),
            Flexible(
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class AdvancedFilterSheet extends StatefulWidget {
  const AdvancedFilterSheet({required this.initial, super.key});

  final MvpFilterSpec initial;

  @override
  State<AdvancedFilterSheet> createState() => _AdvancedFilterSheetState();
}

class _AdvancedFilterSheetState extends State<AdvancedFilterSheet> {
  late RangeValues _priceRange;
  late bool _stockOnly;
  String? _brand;
  String? _shopType;
  String? _platform;

  @override
  void initState() {
    super.initState();
    _priceRange = RangeValues(
      widget.initial.priceMin ?? 0,
      widget.initial.priceMax ?? 1500,
    );
    _stockOnly = widget.initial.stockOnly;
    _brand = widget.initial.brand;
    _shopType = widget.initial.shopType;
    _platform = widget.initial.platform;
  }

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    return FilterBottomSheetFrame(
      title: '筛选',
      bottomPadding: bottomPadding,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _FilterSectionTitle('平台'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final platform in const [
                null,
                'taobao',
                'tmall',
                'jd',
                'dewu',
                'pdd',
                'douyin',
              ])
                FilterSelectChip(
                  label:
                      platform == null ? '全部' : platformDisplayName(platform),
                  selected: _platform == platform,
                  onSelected: () => setState(() => _platform = platform),
                ),
            ],
          ),
          const SizedBox(height: 18),
          const _FilterSectionTitle('品牌'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final brand in popularShoeBrands)
                FilterSelectChip(
                  label: brand,
                  selected: _brand == brand,
                  onSelected: () => setState(() {
                    _brand = _brand == brand ? null : brand;
                  }),
                ),
            ],
          ),
          const SizedBox(height: 18),
          const _FilterSectionTitle('价格区间'),
          Row(
            children: [
              Text(
                '¥${_priceRange.start.round()}',
                style: const TextStyle(
                  color: Color(0xFFFF7A2F),
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const Spacer(),
              Text(
                _priceRange.end >= 1500
                    ? '¥1500+'
                    : '¥${_priceRange.end.round()}',
                style: const TextStyle(
                  color: Color(0xFFFF7A2F),
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          RangeSlider(
            values: _priceRange,
            min: 0,
            max: 1500,
            divisions: 30,
            activeColor: const Color(0xFFFF5B22),
            inactiveColor: Colors.white.withValues(alpha: 0.15),
            onChanged: (value) => setState(() => _priceRange = value),
          ),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final range in const [
                (0.0, 300.0, '300元以下'),
                (300.0, 600.0, '300-600元'),
                (600.0, 1000.0, '600-1000元'),
                (1000.0, 1500.0, '1000元以上'),
              ])
                FilterSelectChip(
                  label: range.$3,
                  selected: _priceRange.start == range.$1 &&
                      _priceRange.end == range.$2,
                  onSelected: () => setState(
                    () => _priceRange = RangeValues(range.$1, range.$2),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 18),
          const _FilterSectionTitle('店铺与服务'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final shopType in const ['旗舰店', '官方店', '授权店'])
                FilterSelectChip(
                  label: shopType,
                  selected: _shopType == shopType,
                  onSelected: () => setState(() {
                    _shopType = _shopType == shopType ? null : shopType;
                  }),
                ),
              FilterSelectChip(
                label: '只看有货',
                selected: _stockOnly,
                onSelected: () => setState(() => _stockOnly = !_stockOnly),
              ),
            ],
          ),
          const SizedBox(height: 22),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () {
                    setState(() {
                      _priceRange = const RangeValues(0, 1500);
                      _stockOnly = false;
                      _brand = null;
                      _shopType = null;
                      _platform = null;
                    });
                  },
                  child: const Text('重置'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  onPressed: () {
                    Navigator.of(context).pop(
                      MvpFilterSpec(
                        priceMin:
                            _priceRange.start <= 0 ? null : _priceRange.start,
                        priceMax:
                            _priceRange.end >= 1500 ? null : _priceRange.end,
                        stockOnly: _stockOnly,
                        platform: _platform,
                        brand: _brand,
                        shopType: _shopType,
                        cheapestFirst: widget.initial.cheapestFirst,
                      ),
                    );
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFFFF5B22),
                    foregroundColor: Colors.white,
                  ),
                  child: const Text('完成'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class FilterBottomSheetFrame extends StatelessWidget {
  const FilterBottomSheetFrame({
    required this.title,
    required this.child,
    this.bottomPadding = 0,
    super.key,
  });

  final String title;
  final Widget child;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.82,
          ),
          padding: EdgeInsets.fromLTRB(18, 12, 18, 18 + bottomPadding),
          decoration: BoxDecoration(
            color: const Color(0xFF11101A).withValues(alpha: 0.96),
            border: Border(
              top: BorderSide(color: Colors.white.withValues(alpha: 0.14)),
            ),
          ),
          child: SingleChildScrollView(
            child: SafeArea(
              top: false,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 42,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.28),
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 14),
                  child,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _FilterSectionTitle extends StatelessWidget {
  const _FilterSectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w900,
          color: Color(0xFFFFF4E6),
        ),
      ),
    );
  }
}

class FilterSelectChip extends StatelessWidget {
  const FilterSelectChip({
    required this.label,
    required this.selected,
    required this.onSelected,
    super.key,
  });

  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    return ChoiceChip(
      selected: selected,
      onSelected: (_) => onSelected(),
      label: Text(label),
      showCheckmark: false,
      selectedColor: const Color(0xFFFF5B22).withValues(alpha: 0.22),
      backgroundColor: Colors.white.withValues(alpha: 0.08),
      side: BorderSide(
        color: selected
            ? const Color(0xFFFF7A2F).withValues(alpha: 0.72)
            : Colors.white.withValues(alpha: 0.12),
      ),
      labelStyle: TextStyle(
        color: selected ? const Color(0xFFFFA65C) : Colors.white,
        fontWeight: FontWeight.w900,
      ),
    );
  }
}

class StyleRecommendationCard extends StatelessWidget {
  const StyleRecommendationCard({
    required this.recommendation,
    required this.onTap,
    this.imageFile,
    super.key,
  });

  final StyleRecommendation recommendation;
  final File? imageFile;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 232,
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(22),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(22),
          child: Ink(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: Colors.white.withValues(alpha: 0.20)),
            ),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(17),
                  child: SizedBox(
                    width: 74,
                    height: 80,
                    child: imageFile == null
                        ? RecommendationThumbnail(
                            colors: recommendation.colors,
                            icon: recommendation.icon,
                          )
                        : Image.file(imageFile!, fit: BoxFit.cover),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        recommendation.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 13.5,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        recommendation.copy,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.82),
                          fontSize: 11.5,
                          height: 1.25,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const Spacer(),
                      Row(
                        children: [
                          Icon(
                            Icons.auto_awesome_rounded,
                            size: 14,
                            color: recommendation.colors.last,
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              recommendation.action,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: recommendation.colors.last,
                                fontSize: 11,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class RecommendationThumbnail extends StatelessWidget {
  const RecommendationThumbnail({
    required this.colors,
    required this.icon,
    super.key,
  });

  final List<Color> colors;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: colors,
            ),
          ),
        ),
        CustomPaint(painter: ThumbnailGrainPainter(color: colors.last)),
        Center(
          child:
              Icon(icon, color: Colors.white.withValues(alpha: 0.90), size: 30),
        ),
      ],
    );
  }
}

class ThumbnailGrainPainter extends CustomPainter {
  ThumbnailGrainPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = Colors.white.withValues(alpha: 0.18);
    for (var i = 0; i < 12; i += 1) {
      final x = size.width * ((i * 37) % 100) / 100;
      final y = size.height * ((i * 53) % 100) / 100;
      canvas.drawCircle(Offset(x, y), 1.0 + (i % 3) * 0.7, paint);
    }
    final glow = Paint()
      ..shader = RadialGradient(
        center: const Alignment(0.62, -0.48),
        radius: 0.84,
        colors: [color.withValues(alpha: 0.30), color.withValues(alpha: 0)],
      ).createShader(Offset.zero & size);
    canvas.drawRect(Offset.zero & size, glow);
  }

  @override
  bool shouldRepaint(covariant ThumbnailGrainPainter oldDelegate) {
    return oldDelegate.color != color;
  }
}

class SessionStatusPanel extends StatelessWidget {
  const SessionStatusPanel({
    required this.sessionId,
    required this.turnCount,
    required this.filterSpec,
    required this.candidateCount,
    required this.lastPrompt,
    super.key,
  });

  final String sessionId;
  final int turnCount;
  final MvpFilterSpec filterSpec;
  final int candidateCount;
  final String lastPrompt;

  @override
  Widget build(BuildContext context) {
    final labels = filterSpec.labels;
    return GlassPanel(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(
                    colors: [Color(0xFF8DFFF1), Color(0xFFA8B7FF)],
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF8DFFF1).withValues(alpha: 0.20),
                      blurRadius: 22,
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.hub_rounded,
                  color: Color(0xFF0E2439),
                  size: 20,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      turnCount == 0 ? '本地候选池已建立' : '已收敛 $turnCount 轮',
                      style: const TextStyle(
                        fontSize: 15.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '$sessionId · $candidateCount 个候选',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFFB7D8D2),
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const _SoftChip(
                icon: Icons.offline_bolt_rounded,
                label: '演示数据',
                color: Color(0xFFFFD37B),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final label in labels)
                _MiniTag(icon: Icons.check_circle_rounded, label: label),
            ],
          ),
          if (lastPrompt.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              '最新要求：$lastPrompt',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFFE4FFF9),
                fontSize: 12.5,
                height: 1.35,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class DemoSuggestion {
  const DemoSuggestion({
    required this.title,
    required this.reason,
    required this.prompt,
    required this.icon,
    required this.color,
  });

  final String title;
  final String reason;
  final String prompt;
  final IconData icon;
  final Color color;
}

class MvpSuggestionStrip extends StatelessWidget {
  const MvpSuggestionStrip({
    required this.suggestions,
    required this.onSelected,
    super.key,
  });

  final List<DemoSuggestion> suggestions;
  final ValueChanged<DemoSuggestion> onSelected;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          '下一步建议',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 10),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final suggestion in suggestions) ...[
                MvpSuggestionCard(
                  suggestion: suggestion,
                  onPressed: () => onSelected(suggestion),
                ),
                const SizedBox(width: 10),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class MvpSuggestionCard extends StatelessWidget {
  const MvpSuggestionCard({
    required this.suggestion,
    required this.onPressed,
    super.key,
  });

  final DemoSuggestion suggestion;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 154,
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(22),
        child: InkWell(
          borderRadius: BorderRadius.circular(22),
          onTap: onPressed,
          child: Ink(
            padding: const EdgeInsets.all(13),
            decoration: BoxDecoration(
              color: suggestion.color.withValues(alpha: 0.13),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(
                color: suggestion.color.withValues(alpha: 0.28),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(suggestion.icon, color: suggestion.color, size: 22),
                const SizedBox(height: 10),
                Text(
                  suggestion.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFFF4FFFD),
                    fontSize: 14,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  suggestion.reason,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFFC5E4DF),
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class ShortlistPoolPanel extends StatelessWidget {
  const ShortlistPoolPanel({
    required this.candidates,
    required this.onOpen,
    required this.onRemove,
    super.key,
  });

  final List<DemoCandidate> candidates;
  final ValueChanged<DemoCandidate> onOpen;
  final ValueChanged<DemoCandidate> onRemove;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.style_rounded, color: Color(0xFFFFD37B)),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  '购物车',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              _SoftChip(
                icon: Icons.auto_awesome_rounded,
                label: '${candidates.length} 件',
                color: const Color(0xFF8BFFD9),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            '搭配推荐已在后台预热，打开购物车商品时优先读取缓存。',
            style: TextStyle(
              color: Color(0xFFC5E4DF),
              fontSize: 12,
              height: 1.35,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final candidate in candidates)
                ShortlistCandidateChip(
                  candidate: candidate,
                  onOpen: () => onOpen(candidate),
                  onRemove: () => onRemove(candidate),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class ShortlistCandidateChip extends StatelessWidget {
  const ShortlistCandidateChip({
    required this.candidate,
    required this.onOpen,
    required this.onRemove,
    super.key,
  });

  final DemoCandidate candidate;
  final VoidCallback onOpen;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: candidate.accentColor.withValues(alpha: 0.14),
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onOpen,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: candidate.accentColor.withValues(alpha: 0.30),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.style_rounded, size: 15, color: candidate.accentColor),
              const SizedBox(width: 5),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 154),
                child: Text(
                  candidate.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(width: 4),
              GestureDetector(
                onTap: onRemove,
                child: const Icon(Icons.close_rounded, size: 15),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class ComparisonPoolPanel extends StatelessWidget {
  const ComparisonPoolPanel({
    required this.candidates,
    required this.onRemove,
    super.key,
  });

  final List<DemoCandidate> candidates;
  final ValueChanged<DemoCandidate> onRemove;

  @override
  Widget build(BuildContext context) {
    final hasPair = candidates.length >= 2;
    return GlassPanel(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.compare_arrows_rounded,
                  color: Color(0xFF8BFFD9)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  hasPair ? '对比池' : '已加入 1 个，继续选一个商品对比',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              _SoftChip(
                icon: Icons.inventory_2_rounded,
                label: '${candidates.length}/2',
                color: const Color(0xFFFFE7A8),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final candidate in candidates)
                SelectedCompareChip(
                  candidate: candidate,
                  onRemove: () => onRemove(candidate),
                ),
            ],
          ),
          if (hasPair) ...[
            const SizedBox(height: 14),
            CompareTable(left: candidates[0], right: candidates[1]),
          ],
        ],
      ),
    );
  }
}

class SelectedCompareChip extends StatelessWidget {
  const SelectedCompareChip({
    required this.candidate,
    required this.onRemove,
    super.key,
  });

  final DemoCandidate candidate;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: candidate.accentColor.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(16),
        border:
            Border.all(color: candidate.accentColor.withValues(alpha: 0.30)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.directions_run_rounded,
              size: 15, color: candidate.accentColor),
          const SizedBox(width: 5),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 150),
            child: Text(
              candidate.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style:
                  const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800),
            ),
          ),
          const SizedBox(width: 4),
          GestureDetector(
            onTap: onRemove,
            child: const Icon(Icons.close_rounded, size: 15),
          ),
        ],
      ),
    );
  }
}

class CompareTable extends StatelessWidget {
  const CompareTable({required this.left, required this.right, super.key});

  final DemoCandidate left;
  final DemoCandidate right;

  @override
  Widget build(BuildContext context) {
    final rows = [
      CompareMetric(
        label: '材质',
        leftText: left.material,
        rightText: right.material,
        leftScore: left.materialScore,
        rightScore: right.materialScore,
      ),
      CompareMetric(
        label: '价格',
        leftText: '¥${left.amount.toStringAsFixed(0)}',
        rightText: '¥${right.amount.toStringAsFixed(0)}',
        leftScore: right.amount,
        rightScore: left.amount,
      ),
      CompareMetric(
        label: '库存',
        leftText: left.stockLabel,
        rightText: right.stockLabel,
        leftScore: left.stockScore,
        rightScore: right.stockScore,
      ),
      CompareMetric(
        label: '透气',
        leftText: '${left.breathabilityScore.round()}%',
        rightText: '${right.breathabilityScore.round()}%',
        leftScore: left.breathabilityScore,
        rightScore: right.breathabilityScore,
      ),
      CompareMetric(
        label: '日常',
        leftText: '${left.dailyScore.round()}%',
        rightText: '${right.dailyScore.round()}%',
        leftScore: left.dailyScore,
        rightScore: right.dailyScore,
      ),
    ];

    return Column(
      children: [
        Row(
          children: [
            const SizedBox(width: 52),
            Expanded(child: CompareHeader(candidate: left)),
            const SizedBox(width: 8),
            Expanded(child: CompareHeader(candidate: right)),
          ],
        ),
        const SizedBox(height: 8),
        for (final row in rows) CompareMetricRow(metric: row),
      ],
    );
  }
}

class CompareHeader extends StatelessWidget {
  const CompareHeader({required this.candidate, super.key});

  final DemoCandidate candidate;

  @override
  Widget build(BuildContext context) {
    return Text(
      candidate.platform,
      textAlign: TextAlign.center,
      style: TextStyle(
        color: candidate.accentColor,
        fontSize: 12,
        fontWeight: FontWeight.w900,
      ),
    );
  }
}

class CompareMetric {
  const CompareMetric({
    required this.label,
    required this.leftText,
    required this.rightText,
    required this.leftScore,
    required this.rightScore,
  });

  final String label;
  final String leftText;
  final String rightText;
  final double leftScore;
  final double rightScore;
}

class CompareMetricRow extends StatelessWidget {
  const CompareMetricRow({required this.metric, super.key});

  final CompareMetric metric;

  @override
  Widget build(BuildContext context) {
    final leftBetter = metric.leftScore > metric.rightScore;
    final rightBetter = metric.rightScore > metric.leftScore;
    final isNeutral = (metric.leftScore - metric.rightScore).abs() < 0.01;
    final total = metric.leftScore + metric.rightScore;
    final leftPercent = total <= 0 ? 50.0 : metric.leftScore / total * 100;
    final rightPercent = 100 - leftPercent;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          SizedBox(
            width: 52,
            child: Text(
              metric.label,
              style: const TextStyle(
                color: Color(0xFFD9F4EF),
                fontSize: 12,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          Expanded(
            child: CompareValue(
              text: metric.leftText,
              percent: leftPercent,
              isBetter: leftBetter && !rightBetter,
              isNeutral: isNeutral,
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 7),
            child: Text(
              '---',
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.38),
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          Expanded(
            child: CompareValue(
              text: metric.rightText,
              percent: rightPercent,
              isBetter: rightBetter && !leftBetter,
              isNeutral: isNeutral,
            ),
          ),
        ],
      ),
    );
  }
}

class CompareValue extends StatelessWidget {
  const CompareValue({
    required this.text,
    required this.percent,
    required this.isBetter,
    required this.isNeutral,
    super.key,
  });

  final String text;
  final double percent;
  final bool isBetter;
  final bool isNeutral;

  @override
  Widget build(BuildContext context) {
    final color = isNeutral
        ? const Color(0xFFFFE7A8)
        : isBetter
            ? const Color(0xFF8BFFD9)
            : const Color(0xFFFFA9B5);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.22)),
      ),
      child: Column(
        children: [
          Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: color,
              fontSize: 11.5,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            '${percent.round()}%',
            style: TextStyle(
              color: color.withValues(alpha: 0.92),
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class RankedStreamedCandidateList extends StatelessWidget {
  const RankedStreamedCandidateList({
    required this.candidates,
    required this.isStreaming,
    required this.shimmer,
    required this.onOpen,
    required this.onPay,
    required this.onShortlist,
    super.key,
  });

  final List<DemoCandidate> candidates;
  final bool isStreaming;
  final double shimmer;
  final ValueChanged<DemoCandidate> onOpen;
  final ValueChanged<DemoCandidate> onPay;
  final ValueChanged<DemoCandidate> onShortlist;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (isStreaming) ...[
          const MatchSearchProgressBanner(),
          const SizedBox(height: 10),
        ],
        for (var index = 0; index < candidates.length; index += 1)
          AnimatedProductCard(
            candidate: candidates[index],
            index: index,
            shimmer: (shimmer + index * 0.11) % 1,
            onTap: () => onOpen(candidates[index]),
            onPay: () => onPay(candidates[index]),
            onShortlist: () => onShortlist(candidates[index]),
          ),
      ],
    );
  }
}

class MatchSearchProgressBanner extends StatelessWidget {
  const MatchSearchProgressBanner({super.key});

  @override
  Widget build(BuildContext context) {
    const accent = Color(0xFFFFA45D);
    return GlassPanel(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          Stack(
            alignment: Alignment.center,
            children: [
              SizedBox(
                width: 32,
                height: 32,
                child: CircularProgressIndicator(
                  strokeWidth: 2.4,
                  color: accent,
                  backgroundColor: Colors.white.withValues(alpha: 0.12),
                ),
              ),
              const Icon(
                Icons.auto_awesome_rounded,
                color: Color(0xFFFFF6D8),
                size: 18,
              ),
            ],
          ),
          const SizedBox(width: 10),
          const Expanded(
            child: Text(
              '正在按匹配度整理结果，多个平台商品会混合出现',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: Color(0xFFFFF6D8),
                fontSize: 13,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class AnimatedProductCard extends StatelessWidget {
  const AnimatedProductCard({
    required this.candidate,
    required this.index,
    required this.shimmer,
    required this.onTap,
    required this.onPay,
    required this.onShortlist,
    super.key,
  });

  final DemoCandidate candidate;
  final int index;
  final double shimmer;
  final VoidCallback onTap;
  final VoidCallback onPay;
  final VoidCallback onShortlist;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: 520 + index * 80),
      curve: Curves.easeOutCubic,
      builder: (context, value, child) {
        return Opacity(
          opacity: value,
          child: Transform.translate(
            offset: Offset(0, (1 - value) * 24),
            child: Transform.scale(
              scale: 0.96 + value * 0.04,
              child: child,
            ),
          ),
        );
      },
      child: Dismissible(
        key: ValueKey('shortlist-${candidate.candidateItemId}'),
        direction: DismissDirection.endToStart,
        dismissThresholds: const {
          DismissDirection.endToStart: 0.32,
        },
        background: const SizedBox.shrink(),
        secondaryBackground: ShortlistSwipeBackground(candidate: candidate),
        onDismissed: (_) => onShortlist(),
        child: Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Stack(
            children: [
              CandidateCard(
                candidate: candidate,
                onTap: onTap,
                onPay: onPay,
              ),
              Positioned.fill(
                child: IgnorePointer(
                  child: CustomPaint(
                    painter: CardSparkPainter(
                      progress: (shimmer + index * 0.18) % 1,
                      color: candidate.accentColor,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class ShortlistSwipeBackground extends StatelessWidget {
  const ShortlistSwipeBackground({required this.candidate, super.key});

  final DemoCandidate candidate;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 18),
        alignment: Alignment.centerRight,
        decoration: BoxDecoration(
          color: candidate.accentColor.withValues(alpha: 0.22),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: candidate.accentColor.withValues(alpha: 0.34),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                const Text(
                  '加入购物车',
                  style: TextStyle(
                    color: Color(0xFFF4FFFD),
                    fontSize: 14,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  '预热搭配推荐',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.72),
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            const SizedBox(width: 10),
            Icon(
              Icons.style_rounded,
              color: candidate.accentColor,
              size: 24,
            ),
          ],
        ),
      ),
    );
  }
}

class CardSparkPainter extends CustomPainter {
  CardSparkPainter({required this.progress, required this.color});

  final double progress;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final start =
        Offset(size.width * (1.1 - progress * 1.25), size.height * 0.12);
    final end = start + const Offset(-70, 32);
    final paint = Paint()
      ..shader = LinearGradient(
        colors: [
          Colors.white.withValues(alpha: 0),
          color.withValues(alpha: 0.62),
          Colors.white.withValues(alpha: 0),
        ],
      ).createShader(Rect.fromPoints(start, end))
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(start, end, paint);

    final secondStart = Offset(
      size.width * (0.95 - progress * 1.10),
      size.height * 0.52,
    );
    final secondEnd = secondStart + const Offset(-48, 22);
    canvas.drawLine(
      secondStart,
      secondEnd,
      Paint()
        ..shader = LinearGradient(
          colors: [
            Colors.white.withValues(alpha: 0),
            Colors.white.withValues(alpha: 0.42),
            Colors.white.withValues(alpha: 0),
          ],
        ).createShader(Rect.fromPoints(secondStart, secondEnd))
        ..strokeWidth = 1.1
        ..strokeCap = StrokeCap.round,
    );

    _drawSpark(
      canvas,
      Offset(size.width * (0.18 + progress * 0.60), size.height * 0.24),
      3.0,
      0.72,
    );
    _drawSpark(
      canvas,
      Offset(size.width * (0.82 - progress * 0.44), size.height * 0.74),
      2.4,
      0.48,
    );
  }

  void _drawSpark(Canvas canvas, Offset center, double radius, double alpha) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: alpha)
      ..strokeWidth = 1
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(
      Offset(center.dx - radius, center.dy),
      Offset(center.dx + radius, center.dy),
      paint,
    );
    canvas.drawLine(
      Offset(center.dx, center.dy - radius),
      Offset(center.dx, center.dy + radius),
      paint,
    );
  }

  @override
  bool shouldRepaint(covariant CardSparkPainter oldDelegate) {
    return oldDelegate.progress != progress || oldDelegate.color != color;
  }
}

class ProductThumbnail extends StatelessWidget {
  const ProductThumbnail({
    required this.imageUrl,
    required this.accentColor,
    required this.iconSize,
    super.key,
  });

  final String? imageUrl;
  final Color accentColor;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    final url = imageUrl?.trim();
    if (url == null || url.isEmpty || url.startsWith('mock://')) {
      return _fallbackIcon();
    }
    if (url.startsWith('data:image')) {
      final commaIndex = url.indexOf(',');
      if (commaIndex > 0) {
        try {
          final bytes = base64Decode(url.substring(commaIndex + 1));
          return Image.memory(bytes, fit: BoxFit.cover);
        } catch (_) {
          return _fallbackIcon();
        }
      }
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return Image.network(
        url,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => _fallbackIcon(),
      );
    }
    return _fallbackIcon();
  }

  Widget _fallbackIcon() {
    return Icon(
      Icons.directions_run_rounded,
      color: accentColor,
      size: iconSize,
    );
  }
}

class PlatformLogoBadge extends StatelessWidget {
  const PlatformLogoBadge({
    required this.platform,
    this.size = 26,
    super.key,
  });

  final String platform;
  final double size;

  @override
  Widget build(BuildContext context) {
    final background = platformLogoBackground(platform);
    final accent = platformAccentColor(platform);
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(size * 0.28),
        border: Border.all(color: Colors.white.withValues(alpha: 0.72)),
        boxShadow: [
          BoxShadow(
            color: accent.withValues(alpha: 0.35),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Text(
        platformLogoText(platform),
        style: TextStyle(
          color: Colors.white,
          fontSize: size * 0.48,
          fontWeight: FontWeight.w900,
          height: 1,
        ),
      ),
    );
  }
}

class CandidateCard extends StatelessWidget {
  const CandidateCard({
    required this.candidate,
    required this.onTap,
    required this.onPay,
    super.key,
  });

  final DemoCandidate candidate;
  final VoidCallback onTap;
  final VoidCallback onPay;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: GlassPanel(
        padding: const EdgeInsets.fromLTRB(11, 10, 10, 10),
        child: Row(
          children: [
            Container(
              width: 64,
              height: 74,
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(17),
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    candidate.accentColor.withValues(alpha: 0.36),
                    Colors.white.withValues(alpha: 0.06),
                  ],
                ),
                border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
              ),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  ProductThumbnail(
                    imageUrl: candidate.imageUrl,
                    accentColor: candidate.accentColor,
                    iconSize: 32,
                  ),
                  Positioned(
                    left: 6,
                    top: 6,
                    child: PlatformLogoBadge(
                      platform: candidate.platform,
                      size: 23,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    candidate.shopName?.isNotEmpty == true
                        ? '${candidate.title} · ${candidate.shopName}'
                        : candidate.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14.5,
                      height: 1.25,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Row(
                    children: [
                      RatingStars(rating: candidate.rating),
                      const SizedBox(width: 5),
                      Text(
                        candidate.rating.toStringAsFixed(1),
                        style: const TextStyle(
                          color: Color(0xFFFFD77A),
                          fontSize: 11.5,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          candidate.reason,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.68),
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 5),
                  Row(
                    children: [
                      Text(
                        '¥${candidate.amount.toStringAsFixed(0)}',
                        style: const TextStyle(
                          color: Color(0xFF95FFE0),
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(width: 8),
                      _StockChip(status: candidate.stockStatus),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 7,
                    runSpacing: 7,
                    children: [
                      _MiniTag(
                          icon: Icons.storefront_rounded,
                          label: platformDisplayName(candidate.platform)),
                      _MiniTag(
                          icon: Icons.verified_rounded,
                          label: '匹配 ${(candidate.matchScore * 100).round()}%'),
                      _MiniTag(
                          icon: Icons.local_shipping_rounded,
                          label: candidate.deliveryLabel),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: onTap,
                      icon: const Icon(Icons.info_outline_rounded, size: 16),
                      label: const Text('详情'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, 34),
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        foregroundColor: Colors.white.withValues(alpha: 0.86),
                        side: BorderSide(
                          color: Colors.white.withValues(alpha: 0.22),
                        ),
                        textStyle: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 6),
            Icon(
              Icons.chevron_right_rounded,
              color: Colors.white.withValues(alpha: 0.48),
              size: 24,
            ),
          ],
        ),
      ),
    );
  }
}

class RatingStars extends StatelessWidget {
  const RatingStars({required this.rating, super.key});

  final double rating;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var index = 0; index < 5; index += 1)
          Icon(
            rating >= index + 0.75
                ? Icons.star_rounded
                : rating >= index + 0.25
                    ? Icons.star_half_rounded
                    : Icons.star_border_rounded,
            color: const Color(0xFFFFD77A),
            size: 13,
          ),
      ],
    );
  }
}

class EmptyResultsCard extends StatelessWidget {
  const EmptyResultsCard({this.onLoosen, super.key});

  final VoidCallback? onLoosen;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '当前条件下没有候选，可以放宽价格或先保留未知货源。',
            style: TextStyle(color: Color(0xFFD9F4EF), height: 1.45),
          ),
          if (onLoosen != null) ...[
            const SizedBox(height: 12),
            TextButton.icon(
              onPressed: onLoosen,
              icon: const Icon(Icons.tune_rounded),
              label: const Text('放宽条件'),
            ),
          ],
        ],
      ),
    );
  }
}

class CandidateDetailSheet extends StatelessWidget {
  const CandidateDetailSheet({
    required this.candidate,
    required this.sessionId,
    required this.isCompared,
    required this.onCompareToggle,
    required this.onPay,
    super.key,
  });

  final DemoCandidate candidate;
  final String sessionId;
  final bool isCompared;
  final VoidCallback onCompareToggle;
  final VoidCallback onPay;

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    return ClipRRect(
      borderRadius: const BorderRadius.vertical(top: Radius.circular(30)),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: Container(
          padding: EdgeInsets.fromLTRB(18, 12, 18, 18 + bottomPadding),
          decoration: BoxDecoration(
            color: const Color(0xFF081A2D).withValues(alpha: 0.94),
            border: Border(
              top: BorderSide(color: Colors.white.withValues(alpha: 0.16)),
            ),
          ),
          child: SafeArea(
            top: false,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Center(
                    child: Container(
                      width: 42,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.32),
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 86,
                        height: 106,
                        clipBehavior: Clip.antiAlias,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(22),
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              candidate.accentColor.withValues(alpha: 0.42),
                              Colors.white.withValues(alpha: 0.07),
                            ],
                          ),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.14),
                          ),
                        ),
                        child: ProductThumbnail(
                          imageUrl: candidate.imageUrl,
                          accentColor: candidate.accentColor,
                          iconSize: 42,
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              candidate.title,
                              style: const TextStyle(
                                fontSize: 19,
                                height: 1.22,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 10),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                _StockChip(status: candidate.stockStatus),
                                _SoftChip(
                                  icon: Icons.storefront_rounded,
                                  label:
                                      platformDisplayName(candidate.platform),
                                  color: const Color(0xFF93B8FF),
                                ),
                                _SoftChip(
                                  icon: Icons.verified_rounded,
                                  label:
                                      '匹配 ${(candidate.matchScore * 100).round()}%',
                                  color: const Color(0xFF8BFFD9),
                                ),
                                _SoftChip(
                                  icon: Icons.star_rounded,
                                  label: candidate.rating.toStringAsFixed(1),
                                  color: const Color(0xFFFFD77A),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        '¥${candidate.amount.toStringAsFixed(0)}',
                        style: const TextStyle(
                          color: Color(0xFF95FFE0),
                          fontSize: 34,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          '${candidate.reason} · ${candidate.candidateItemId} · $sessionId',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Color(0xFFB9D9D3),
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final tag in candidate.decisionTags)
                        _MiniTag(icon: Icons.auto_awesome_rounded, label: tag),
                    ],
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    '匹配依据',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 10),
                  for (final bullet in candidate.detailBullets)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            Icons.check_circle_rounded,
                            color: candidate.accentColor,
                            size: 18,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              bullet,
                              style: const TextStyle(
                                color: Color(0xFFE3F9F4),
                                height: 1.38,
                                fontSize: 13.5,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: () {
                            onCompareToggle();
                            ScaffoldMessenger.of(context)
                              ..hideCurrentSnackBar()
                              ..showSnackBar(
                                SnackBar(
                                  content: Text(
                                    isCompared
                                        ? '已移出对比池。'
                                        : '已加入对比池，再选一个商品即可对比。',
                                  ),
                                  behavior: SnackBarBehavior.floating,
                                ),
                              );
                            Navigator.of(context).pop();
                          },
                          icon: Icon(
                            isCompared
                                ? Icons.remove_circle_outline_rounded
                                : Icons.compare_arrows_rounded,
                          ),
                          label: Text(isCompared ? '移出对比' : '加入对比'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () {
                            final url = candidate.productUrl;
                            if (url != null && url.isNotEmpty) {
                              unawaited(
                                  Clipboard.setData(ClipboardData(text: url)));
                            }
                            ScaffoldMessenger.of(context)
                              ..hideCurrentSnackBar()
                              ..showSnackBar(
                                SnackBar(
                                  content: Text(
                                    candidate.productUrl?.isNotEmpty == true
                                        ? '已复制商城链接，后续可接外跳打开。'
                                        : '后端暂未返回商品来源链接。',
                                  ),
                                  behavior: SnackBarBehavior.floating,
                                ),
                              );
                          },
                          icon: const Icon(Icons.open_in_new_rounded),
                          label: const Text('查看来源'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  FilledButton.icon(
                    onPressed: onPay,
                    icon: const Icon(Icons.payment_rounded),
                    label: const Text('选择支付方式'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      backgroundColor: const Color(0xFFFFE7A8),
                      foregroundColor: const Color(0xFF1C1428),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class PaymentActionSheet extends StatefulWidget {
  const PaymentActionSheet({required this.candidate, super.key});

  final DemoCandidate candidate;

  @override
  State<PaymentActionSheet> createState() => _PaymentActionSheetState();
}

class _PaymentActionSheetState extends State<PaymentActionSheet> {
  String _method = 'wechat_pay';

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    final candidate = widget.candidate;
    const methods = [
      PaymentMethodOption(
        code: 'wechat_pay',
        label: '微信支付',
        shortLabel: '微',
        color: Color(0xFF21C05E),
        icon: Icons.chat_bubble_rounded,
      ),
      PaymentMethodOption(
        code: 'alipay',
        label: '支付宝',
        shortLabel: '支',
        color: Color(0xFF1677FF),
        icon: Icons.account_balance_wallet_rounded,
      ),
      PaymentMethodOption(
        code: 'unionpay',
        label: '银联支付',
        shortLabel: '联',
        color: Color(0xFF005BAC),
        icon: Icons.credit_card_rounded,
      ),
    ];

    return ClipRRect(
      borderRadius: const BorderRadius.vertical(top: Radius.circular(30)),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: Container(
          padding: EdgeInsets.fromLTRB(18, 12, 18, 18 + bottomPadding),
          decoration: BoxDecoration(
            color: const Color(0xFF081A2D).withValues(alpha: 0.96),
            border: Border(
              top: BorderSide(color: Colors.white.withValues(alpha: 0.16)),
            ),
          ),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.32),
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                const Text(
                  '确认支付',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 12),
                GlassPanel(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      PlatformLogoBadge(platform: candidate.platform, size: 34),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              candidate.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 5),
                            Text(
                              '${platformDisplayName(candidate.platform)} · ${candidate.shopName?.isNotEmpty == true ? candidate.shopName : '店铺待确认'}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.68),
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        '¥${candidate.amount.toStringAsFixed(0)}',
                        style: const TextStyle(
                          color: Color(0xFF95FFE0),
                          fontSize: 24,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    for (var index = 0; index < methods.length; index += 1) ...[
                      Expanded(
                        child: PaymentMethodTile(
                          option: methods[index],
                          selected: _method == methods[index].code,
                          onTap: () => setState(
                            () => _method = methods[index].code,
                          ),
                        ),
                      ),
                      if (index != methods.length - 1) const SizedBox(width: 8),
                    ],
                  ],
                ),
                if (candidate.productUrl?.isNotEmpty == true) ...[
                  const SizedBox(height: 14),
                  GlassPanel(
                    padding: const EdgeInsets.all(11),
                    child: Row(
                      children: [
                        const Icon(Icons.link_rounded, size: 18),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            candidate.productUrl!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.72),
                              fontSize: 11.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () {
                          final url = candidate.productUrl;
                          if (url != null && url.isNotEmpty) {
                            unawaited(
                              Clipboard.setData(ClipboardData(text: url)),
                            );
                          }
                          ScaffoldMessenger.of(context)
                            ..hideCurrentSnackBar()
                            ..showSnackBar(
                              SnackBar(
                                content: Text(
                                  url != null && url.isNotEmpty
                                      ? '已复制商城链接。'
                                      : '后端暂未返回商城链接。',
                                ),
                                behavior: SnackBarBehavior.floating,
                              ),
                            );
                        },
                        icon: const Icon(Icons.copy_rounded),
                        label: const Text('复制链接'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: () {
                          Navigator.of(context).pop();
                          ScaffoldMessenger.of(context)
                            ..hideCurrentSnackBar()
                            ..showSnackBar(
                              SnackBar(
                                content: Text(
                                  '已选择 ${_selectedPaymentLabel(methods)}，支付接口后续接入真实平台。',
                                ),
                                behavior: SnackBarBehavior.floating,
                              ),
                            );
                        },
                        icon: const Icon(Icons.lock_rounded),
                        label: const Text('打开商品链接'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _selectedPaymentLabel(List<PaymentMethodOption> methods) {
    return methods
        .firstWhere(
          (method) => method.code == _method,
          orElse: () => methods.first,
        )
        .label;
  }
}

class PaymentMethodOption {
  const PaymentMethodOption({
    required this.code,
    required this.label,
    required this.shortLabel,
    required this.color,
    required this.icon,
  });

  final String code;
  final String label;
  final String shortLabel;
  final Color color;
  final IconData icon;
}

class PaymentMethodTile extends StatelessWidget {
  const PaymentMethodTile({
    required this.option,
    required this.selected,
    required this.onTap,
    super.key,
  });

  final PaymentMethodOption option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        decoration: BoxDecoration(
          color: selected
              ? option.color.withValues(alpha: 0.18)
              : Colors.white.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: selected
                ? option.color.withValues(alpha: 0.70)
                : Colors.white.withValues(alpha: 0.12),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 30,
              height: 30,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: option.color,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                option.shortLabel,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              option.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: selected
                    ? Colors.white
                    : Colors.white.withValues(alpha: 0.78),
                fontSize: 11,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class AssistantBubble extends StatelessWidget {
  const AssistantBubble({
    required this.message,
    this.onAssistantTap,
    super.key,
  });

  final String message;
  final VoidCallback? onAssistantTap;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 252),
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 320),
            child: GlassPanel(
              key: ValueKey(message),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Text(
                message,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFFE7FFF9),
                  fontSize: 12.5,
                  height: 1.18,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        Tooltip(
          message: '使用答疑',
          child: GestureDetector(
            onTap: onAssistantTap,
            child: const RobotLogo(size: 50),
          ),
        ),
      ],
    );
  }
}

class HomeAssistantIcon extends StatelessWidget {
  const HomeAssistantIcon({required this.size, super.key});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF12C8FF),
            Color(0xFF006BFF),
            Color(0xFF5048FF),
          ],
        ),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF006BFF).withValues(alpha: 0.52),
            blurRadius: 22,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: CustomPaint(painter: HomeAssistantIconPainter()),
    );
  }
}

class HomeAssistantIconPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.92)
      ..style = PaintingStyle.stroke
      ..strokeWidth = size.width * 0.065
      ..strokeCap = StrokeCap.round;
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width * 0.16;

    for (var i = 0; i < 4; i += 1) {
      final angle = pi / 4 + i * pi / 2;
      final dot = center + Offset(cos(angle), sin(angle)) * radius;
      canvas.drawCircle(dot, size.width * 0.055, Paint()..color = Colors.white);
      canvas.drawLine(center, dot, paint);
    }
    canvas.drawCircle(
      center,
      size.width * 0.065,
      Paint()..color = Colors.white.withValues(alpha: 0.98),
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class AssistantHelpSheet extends StatefulWidget {
  const AssistantHelpSheet({super.key});

  @override
  State<AssistantHelpSheet> createState() => _AssistantHelpSheetState();
}

class _AssistantHelpSheetState extends State<AssistantHelpSheet> {
  final _questionController = TextEditingController();
  String? _answer;
  bool _isSubmitting = false;

  @override
  void dispose() {
    _questionController.dispose();
    super.dispose();
  }

  Future<void> _submitQuestion() async {
    final question = _questionController.text.trim();
    if (question.isEmpty || _isSubmitting) return;
    setState(() => _isSubmitting = true);
    final answer = await requirementSubmitter.submitAssistantQuestion(question);
    if (!mounted) return;
    setState(() {
      _answer = answer;
      _isSubmitting = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    return ClipRRect(
      borderRadius: const BorderRadius.vertical(top: Radius.circular(30)),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: Container(
          padding: EdgeInsets.fromLTRB(18, 14, 18, 18 + bottomPadding),
          decoration: BoxDecoration(
            color: const Color(0xFF081A2D).withValues(alpha: 0.96),
            border: Border(
              top: BorderSide(color: Colors.white.withValues(alpha: 0.16)),
            ),
          ),
          child: SafeArea(
            top: false,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Center(
                    child: Container(
                      width: 42,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.32),
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Row(
                    children: [
                      RobotLogo(size: 42),
                      SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'App 使用答疑',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  const Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _MiniTag(
                          icon: Icons.photo_camera_rounded, label: '拍照找同款'),
                      _MiniTag(icon: Icons.mic_rounded, label: '语音直接搜索'),
                      _MiniTag(icon: Icons.tune_rounded, label: '继续收敛条件'),
                      _MiniTag(icon: Icons.touch_app_rounded, label: '点商品看详情'),
                    ],
                  ),
                  const SizedBox(height: 16),
                  const HelpQuestionCard(
                    question: '我不拍照也能搜吗？',
                    answer:
                        '可以。点击“语音助手搜索”，直接说出商品型号、颜色、预算和货源要求，当前前端会先用 demo 候选展示，后续接大模型和后端搜索。',
                  ),
                  const HelpQuestionCard(
                    question: '搜出来以后怎么继续筛？',
                    answer: '可以点快捷标签，也可以在继续收敛框输入“500以内”“只看有货”“先看最低价”等要求。',
                  ),
                  const HelpQuestionCard(
                    question: '评分和匹配度是什么意思？',
                    answer:
                        '匹配度偏向“是不是像同款”，评分偏向“是否值得优先看”，后续会由价格、库存、店铺和模型判断综合生成。',
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _questionController,
                    minLines: 1,
                    maxLines: 3,
                    decoration: InputDecoration(
                      hintText: '问问我怎么使用这个 App',
                      filled: true,
                      fillColor: Colors.white.withValues(alpha: 0.10),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(18),
                        borderSide: BorderSide.none,
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  FilledButton.icon(
                    onPressed: _isSubmitting ? null : _submitQuestion,
                    icon: _isSubmitting
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send_rounded),
                    label: const Text('咨询助手'),
                  ),
                  if (_answer != null) ...[
                    const SizedBox(height: 12),
                    GlassPanel(
                      padding: const EdgeInsets.all(14),
                      child: Text(
                        _answer!,
                        style: const TextStyle(
                          color: Color(0xFFE7FFF9),
                          height: 1.45,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class HelpQuestionCard extends StatelessWidget {
  const HelpQuestionCard({
    required this.question,
    required this.answer,
    super.key,
  });

  final String question;
  final String answer;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: GlassPanel(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              question,
              style:
                  const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 6),
            Text(
              answer,
              style: const TextStyle(
                color: Color(0xFFD6F3ED),
                fontSize: 12.5,
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class GlassPanel extends StatelessWidget {
  const GlassPanel({
    required this.child,
    this.padding = EdgeInsets.zero,
    super.key,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            color: const Color(0xFF0D1F36).withValues(alpha: 0.44),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF050711).withValues(alpha: 0.28),
                blurRadius: 30,
                offset: const Offset(0, 18),
              ),
            ],
          ),
          child: child,
        ),
      ),
    );
  }
}

class GlassIconButton extends StatelessWidget {
  const GlassIconButton({
    required this.icon,
    required this.onPressed,
    this.strong = false,
    super.key,
  });

  final IconData icon;
  final VoidCallback onPressed;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: strong
          ? const Color(0xFF89FFE3)
          : Colors.white.withValues(alpha: 0.10),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onPressed,
        child: SizedBox(
          width: 44,
          height: 44,
          child: Icon(
            icon,
            color: strong ? const Color(0xFF031614) : const Color(0xFFE9FFF9),
          ),
        ),
      ),
    );
  }
}

class _SoftChip extends StatelessWidget {
  const _SoftChip({
    required this.icon,
    required this.label,
    required this.color,
  });

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 15),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _MiniTag extends StatelessWidget {
  const _MiniTag({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: const Color(0xFFC7ECE5)),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFFC7ECE5),
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _StockChip extends StatelessWidget {
  const _StockChip({required this.status});

  final StockStatus status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      StockStatus.inStock => const Color(0xFF8BFFD9),
      StockStatus.unknown => const Color(0xFFFFE2A6),
      StockStatus.outOfStock => const Color(0xFFFFA9B5),
    };
    final text = switch (status) {
      StockStatus.inStock => '有货',
      StockStatus.unknown => '未知',
      StockStatus.outOfStock => '无货',
    };
    return _SoftChip(icon: Icons.inventory_rounded, label: text, color: color);
  }
}

enum StockStatus { inStock, unknown, outOfStock }

class StyleRecommendation {
  const StyleRecommendation({
    required this.title,
    required this.copy,
    required this.action,
    required this.prompt,
    required this.icon,
    required this.colors,
  });

  final String title;
  final String copy;
  final String action;
  final String prompt;
  final IconData icon;
  final List<Color> colors;
}

const styleRecommendations = [
  StyleRecommendation(
    title: '赛木里湖打卡感',
    copy: '当前鞋款偏轻运动风，和湖边蓝白外套、浅色长裤的旅行穿搭很契合。',
    action: '筛出轻便有货款',
    prompt: '只看有货，轻便一点',
    icon: Icons.landscape_rounded,
    colors: [Color(0xFF6D7FB6), Color(0xFFE8C08A), Color(0xFFFFD77A)],
  ),
  StyleRecommendation(
    title: '周末城市通勤',
    copy: '黑白鞋更适合灰色卫衣、直筒裤和托特包，低调但不沉闷。',
    action: '500以内优先',
    prompt: '500以内，先看最低价',
    icon: Icons.location_city_rounded,
    colors: [Color(0xFF463046), Color(0xFFB47561), Color(0xFFFFB84A)],
  ),
  StyleRecommendation(
    title: '爆款同色系',
    copy: '这类黑白跑鞋近期更容易搭户外机能外套，可以保留同系列替代款。',
    action: '加入替代款',
    prompt: '可以看同系列替代款',
    icon: Icons.local_fire_department_rounded,
    colors: [Color(0xFF3F2B50), Color(0xFFE68458), Color(0xFFFFD36C)],
  ),
];

const popularShoeBrands = [
  'Nike',
  'adidas',
  'Air Jordan',
  'New Balance',
  'ASICS',
  'PUMA',
  'HOKA',
  'On',
  'Salomon',
  'Converse',
  'Vans',
  '李宁',
  '安踏',
  '特步',
  '361°',
];

class MvpFilterSpec {
  const MvpFilterSpec({
    this.priceMin,
    this.priceMax,
    this.stockOnly = false,
    this.platform,
    this.brand,
    this.shopType,
    this.cheapestFirst = false,
  });

  final double? priceMin;
  final double? priceMax;
  final bool stockOnly;
  final String? platform;
  final String? brand;
  final String? shopType;
  final bool cheapestFirst;

  MvpFilterSpec mergePrompt(String prompt) {
    final normalized = prompt.trim();
    final nextPrice = _extractPriceMax(normalized);
    final nextPlatform = _extractPlatform(normalized);
    final nextBrand = _extractBrand(normalized);
    final clearsStock = normalized.contains('保留未知') ||
        normalized.contains('不限货源') ||
        normalized.contains('不限库存');
    final wantsStock = normalized.contains('有货') || normalized.contains('现货');
    final wantsCheapest = normalized.contains('最低') ||
        normalized.contains('低价') ||
        normalized.contains('便宜') ||
        normalized.contains('价格优先');

    return MvpFilterSpec(
      priceMin: priceMin,
      priceMax: nextPrice ?? priceMax,
      stockOnly: clearsStock ? false : (wantsStock || stockOnly),
      platform: nextPlatform ?? platform,
      brand: nextBrand ?? brand,
      shopType: shopType,
      cheapestFirst: wantsCheapest || cheapestFirst,
    );
  }

  MvpFilterSpec withPlatform(String? nextPlatform) {
    return MvpFilterSpec(
      priceMin: priceMin,
      priceMax: priceMax,
      stockOnly: stockOnly,
      platform: nextPlatform,
      brand: brand,
      shopType: shopType,
      cheapestFirst: cheapestFirst,
    );
  }

  bool matches(DemoCandidate candidate) {
    if (priceMin != null && candidate.amount < priceMin!) return false;
    if (priceMax != null && candidate.amount > priceMax!) return false;
    if (stockOnly && candidate.stockStatus != StockStatus.inStock) return false;
    if (platform != null &&
        platformDisplayName(candidate.platform) !=
            platformDisplayName(platform!)) {
      return false;
    }
    if (brand != null && !_candidateContains(candidate, brand!)) return false;
    if (shopType != null && !_candidateContains(candidate, shopType!)) {
      return false;
    }
    return true;
  }

  List<String> get labels {
    final chips = <String>[];
    chips.add('鞋类同款');
    if (priceMin != null) chips.add('¥${priceMin!.round()}以上');
    if (priceMax != null) chips.add('¥${priceMax!.round()}以内');
    if (stockOnly) chips.add('只看有货');
    if (platform != null) chips.add(platformDisplayName(platform!));
    if (brand != null) chips.add(brand!);
    if (shopType != null) chips.add(shopType!);
    if (cheapestFirst) chips.add('低价优先');
    return chips;
  }

  int get activeCount {
    var count = 0;
    if (priceMin != null || priceMax != null) count += 1;
    if (stockOnly) count += 1;
    if (platform != null) count += 1;
    if (brand != null) count += 1;
    if (shopType != null) count += 1;
    return count;
  }

  static double? _extractPriceMax(String prompt) {
    final match = RegExp(r'(\d{2,5})\s*(?:元|块|以内|以下|内)?').firstMatch(prompt);
    if (match == null) return null;
    return double.tryParse(match.group(1)!);
  }

  static String? _extractPlatform(String prompt) {
    if (prompt.contains('淘宝')) return 'taobao';
    if (prompt.contains('天猫')) return 'tmall';
    if (prompt.contains('得物')) return 'dewu';
    if (prompt.contains('京东')) return 'jd';
    if (prompt.contains('拼多多')) return 'pdd';
    if (prompt.contains('抖音')) return 'douyin';
    final platformMatch = RegExp(r'平台\s*([A-Ca-c])').firstMatch(prompt);
    if (platformMatch == null) return null;
    return '平台 ${platformMatch.group(1)!.toUpperCase()}';
  }

  static String? _extractBrand(String prompt) {
    final normalized = prompt.toLowerCase();
    for (final brand in popularShoeBrands) {
      if (normalized.contains(brand.toLowerCase())) return brand;
    }
    return null;
  }

  static bool _candidateContains(DemoCandidate candidate, String needle) {
    final normalizedNeedle = needle.toLowerCase();
    final haystack = [
      candidate.title,
      candidate.brand ?? '',
      candidate.shopName ?? '',
      candidate.shopType ?? '',
      candidate.material,
      ...candidate.decisionTags,
    ].join(' ').toLowerCase();
    return haystack.contains(normalizedNeedle);
  }
}

class DemoCandidate {
  const DemoCandidate({
    required this.candidateItemId,
    required this.title,
    required this.platform,
    required this.amount,
    this.brand,
    this.shopName,
    this.shopType,
    this.imageUrl,
    this.productUrl,
    this.platformProductId,
    this.platformBrandId,
    required this.stockStatus,
    required this.reason,
    required this.matchScore,
    required this.rating,
    required this.material,
    required this.materialScore,
    required this.breathabilityScore,
    required this.dailyScore,
    this.deliveryDaysOverride,
    required this.decisionTags,
    required this.detailBullets,
    this.productPoolData = const <String, dynamic>{},
    required this.accentColor,
  });

  final String candidateItemId;
  final String title;
  final String platform;
  final double amount;
  final String? brand;
  final String? shopName;
  final String? shopType;
  final String? imageUrl;
  final String? productUrl;
  final String? platformProductId;
  final String? platformBrandId;
  final StockStatus stockStatus;
  final String reason;
  final double matchScore;
  final double rating;
  final String material;
  final double materialScore;
  final double breathabilityScore;
  final double dailyScore;
  final int? deliveryDaysOverride;
  final List<String> decisionTags;
  final List<String> detailBullets;
  final Map<String, dynamic> productPoolData;
  final Color accentColor;

  Map<String, dynamic> toJson() => {
        'candidateItemId': candidateItemId,
        'title': title,
        'platform': platform,
        'amount': amount,
        if (brand != null) 'brand': brand,
        if (shopName != null) 'shopName': shopName,
        if (shopType != null) 'shopType': shopType,
        if (imageUrl != null) 'imageUrl': imageUrl,
        if (productUrl != null) 'productUrl': productUrl,
        if (platformProductId != null) 'platformProductId': platformProductId,
        if (platformBrandId != null) 'platformBrandId': platformBrandId,
        'stockStatus': stockStatus.name,
        'reason': reason,
        'matchScore': matchScore,
        'rating': rating,
        'material': material,
        'materialScore': materialScore,
        'breathabilityScore': breathabilityScore,
        'dailyScore': dailyScore,
        if (deliveryDaysOverride != null)
          'deliveryDaysOverride': deliveryDaysOverride,
        'decisionTags': decisionTags,
        'detailBullets': detailBullets,
        'productPoolData': productPoolData,
        'accentColor': accentColor.toARGB32(),
      };

  factory DemoCandidate.fromJson(Map<String, dynamic> json) {
    return DemoCandidate(
      candidateItemId: json['candidateItemId']?.toString() ?? '',
      title: json['title']?.toString() ?? '未命名商品',
      platform: json['platform']?.toString() ?? '平台',
      amount: _jsonDouble(json['amount']),
      brand: _jsonOptionalString(json['brand']),
      shopName: _jsonOptionalString(json['shopName']),
      shopType: _jsonOptionalString(json['shopType']),
      imageUrl: _jsonOptionalString(json['imageUrl']),
      productUrl: _jsonOptionalString(json['productUrl']),
      platformProductId: _jsonOptionalString(json['platformProductId']),
      platformBrandId: _jsonOptionalString(json['platformBrandId']),
      stockStatus: StockStatus.values.firstWhere(
        (item) => item.name == json['stockStatus']?.toString(),
        orElse: () => StockStatus.unknown,
      ),
      reason: json['reason']?.toString() ?? '已恢复的候选商品',
      matchScore: _jsonDouble(json['matchScore']),
      rating: _jsonDouble(json['rating']),
      material: json['material']?.toString() ?? '材质待确认',
      materialScore: _jsonDouble(json['materialScore']),
      breathabilityScore: _jsonDouble(json['breathabilityScore']),
      dailyScore: _jsonDouble(json['dailyScore']),
      deliveryDaysOverride: _jsonInt(json['deliveryDaysOverride']),
      decisionTags: _jsonStringList(json['decisionTags']),
      detailBullets: _jsonStringList(json['detailBullets']),
      productPoolData: _softMap(json['productPoolData']),
      accentColor: Color(_jsonInt(json['accentColor']) ?? 0xFF8BFFD9),
    );
  }

  String get stockLabel {
    return switch (stockStatus) {
      StockStatus.inStock => '有货',
      StockStatus.unknown => '未知',
      StockStatus.outOfStock => '无货',
    };
  }

  double get stockScore {
    return switch (stockStatus) {
      StockStatus.inStock => 92,
      StockStatus.unknown => 54,
      StockStatus.outOfStock => 18,
    };
  }

  int get deliveryDays {
    if (deliveryDaysOverride != null) return deliveryDaysOverride!;
    final normalized = platformDisplayName(platform);
    if (normalized == '京东') return 1;
    if (normalized == '得物' || normalized == '天猫') return 2;
    if (normalized == '淘宝' || normalized == '拼多多') return 3;
    return 2 + candidateItemId.hashCode.abs() % 3;
  }

  String get deliveryLabel {
    final days = deliveryDays;
    if (days <= 1) return '最快明日达';
    return '预计 $days 天';
  }
}
