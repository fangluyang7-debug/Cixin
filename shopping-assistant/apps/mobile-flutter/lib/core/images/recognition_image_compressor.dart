import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter_image_compress/flutter_image_compress.dart';

class CompressedRecognitionImage {
  const CompressedRecognitionImage({
    required this.file,
    required this.originalBytes,
    required this.compressedBytes,
    required this.targetLongEdge,
    required this.quality,
    required this.usedFallback,
  });

  final File file;
  final int originalBytes;
  final int compressedBytes;
  final int targetLongEdge;
  final int quality;
  final bool usedFallback;

  double get ratio {
    if (originalBytes <= 0) return 1;
    return compressedBytes / originalBytes;
  }
}

class RecognitionImageSelection {
  const RecognitionImageSelection({
    required this.left,
    required this.top,
    required this.width,
    required this.height,
  });

  final double left;
  final double top;
  final double width;
  final double height;

  ui.Rect get normalizedRect => ui.Rect.fromLTWH(left, top, width, height);
}

class RecognitionImageCropper {
  const RecognitionImageCropper._();

  static Future<File> cropToSelection({
    required File source,
    required RecognitionImageSelection selection,
  }) async {
    final bytes = await source.readAsBytes();
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    final image = frame.image;
    final normalized = selection.normalizedRect;
    final sourceRect = ui.Rect.fromLTWH(
      (normalized.left * image.width).clamp(0, image.width - 1).toDouble(),
      (normalized.top * image.height).clamp(0, image.height - 1).toDouble(),
      (normalized.width * image.width).clamp(1, image.width).toDouble(),
      (normalized.height * image.height).clamp(1, image.height).toDouble(),
    );
    final boundedSourceRect = sourceRect.intersect(
      ui.Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()),
    );

    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder);
    final targetRect = ui.Rect.fromLTWH(
      0,
      0,
      boundedSourceRect.width,
      boundedSourceRect.height,
    );
    canvas.drawImageRect(image, boundedSourceRect, targetRect, ui.Paint());
    final picture = recorder.endRecording();
    final cropped = await picture.toImage(
      boundedSourceRect.width.round(),
      boundedSourceRect.height.round(),
    );
    final pngBytes = await cropped.toByteData(format: ui.ImageByteFormat.png);

    image.dispose();
    cropped.dispose();
    picture.dispose();
    codec.dispose();

    if (pngBytes == null) return source;
    final targetFile = File(_targetPath('subject-crop', 'png'));
    await targetFile.writeAsBytes(
      Uint8List.view(pngBytes.buffer),
      flush: true,
    );
    return targetFile;
  }

  static String _targetPath(String prefix, String extension) {
    final separator = Platform.pathSeparator;
    final stamp = DateTime.now().microsecondsSinceEpoch;
    return '${Directory.systemTemp.path}${separator}shopping-assistant-$prefix-$stamp.$extension';
  }
}

class RecognitionImageCompressor {
  const RecognitionImageCompressor._();

  static const int maxRecognitionBytes = 500 * 1024;

  static Future<CompressedRecognitionImage> compress(File source) async {
    final originalBytes = await source.length();
    const attempts = [
      _CompressionAttempt(longEdge: 1024, quality: 70),
      _CompressionAttempt(longEdge: 960, quality: 64),
      _CompressionAttempt(longEdge: 800, quality: 58),
    ];

    _CompressionResult? best;
    for (final attempt in attempts) {
      final bytes = await FlutterImageCompress.compressWithFile(
        source.path,
        minWidth: attempt.longEdge,
        minHeight: attempt.longEdge,
        quality: attempt.quality,
        format: CompressFormat.jpeg,
        keepExif: false,
        autoCorrectionAngle: true,
      );
      if (bytes == null || bytes.isEmpty) continue;

      final result = _CompressionResult(
        bytes: bytes,
        targetLongEdge: attempt.longEdge,
        quality: attempt.quality,
      );
      best = result;
      if (bytes.length <= maxRecognitionBytes) break;
    }

    if (best == null) {
      return CompressedRecognitionImage(
        file: source,
        originalBytes: originalBytes,
        compressedBytes: originalBytes,
        targetLongEdge: 0,
        quality: 0,
        usedFallback: true,
      );
    }

    final targetFile = File(_targetPath());
    await targetFile.writeAsBytes(best.bytes, flush: true);
    return CompressedRecognitionImage(
      file: targetFile,
      originalBytes: originalBytes,
      compressedBytes: best.bytes.length,
      targetLongEdge: best.targetLongEdge,
      quality: best.quality,
      usedFallback: false,
    );
  }

  static String _targetPath() {
    final separator = Platform.pathSeparator;
    final stamp = DateTime.now().microsecondsSinceEpoch;
    return '${Directory.systemTemp.path}${separator}shopping-assistant-recognition-$stamp.jpg';
  }
}

class _CompressionAttempt {
  const _CompressionAttempt({
    required this.longEdge,
    required this.quality,
  });

  final int longEdge;
  final int quality;
}

class _CompressionResult {
  const _CompressionResult({
    required this.bytes,
    required this.targetLongEdge,
    required this.quality,
  });

  final List<int> bytes;
  final int targetLongEdge;
  final int quality;
}
