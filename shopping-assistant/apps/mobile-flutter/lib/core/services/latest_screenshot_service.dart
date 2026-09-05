import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

const MethodChannel _latestScreenshotChannel = MethodChannel(
  'shopping_assistant/latest_screenshot',
);

class LatestScreenshot {
  const LatestScreenshot({
    required this.uri,
    required this.cachePath,
    required this.displayName,
    required this.relativePath,
    required this.dateAddedMs,
    required this.dateTakenMs,
    required this.sizeBytes,
  });

  final String uri;
  final String cachePath;
  final String displayName;
  final String relativePath;
  final int dateAddedMs;
  final int dateTakenMs;
  final int sizeBytes;

  String get dedupeKey => '$uri|$dateAddedMs|$sizeBytes';

  factory LatestScreenshot.fromMap(Map<dynamic, dynamic> value) {
    return LatestScreenshot(
      uri: value['uri']?.toString() ?? '',
      cachePath: value['cachePath']?.toString() ?? '',
      displayName: value['displayName']?.toString() ?? '',
      relativePath: value['relativePath']?.toString() ?? '',
      dateAddedMs: _toInt(value['dateAddedMs']),
      dateTakenMs: _toInt(value['dateTakenMs']),
      sizeBytes: _toInt(value['sizeBytes']),
    );
  }

  static int _toInt(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value) ?? 0;
    return 0;
  }
}

class LatestScreenshotService {
  const LatestScreenshotService({
    MethodChannel channel = _latestScreenshotChannel,
  }) : _channel = channel;

  final MethodChannel _channel;

  Future<LatestScreenshot?> findLatestScreenshot({
    Duration maxAge = const Duration(minutes: 3),
    int limit = 20,
    int minSizeBytes = 20 * 1024,
  }) async {
    if (!Platform.isAndroid) return null;
    try {
      final result = await _channel.invokeMethod<Object?>(
        'findLatestScreenshot',
        <String, Object>{
          'maxAgeMs': maxAge.inMilliseconds,
          'limit': limit,
          'minSizeBytes': minSizeBytes,
        },
      );
      if (result is! Map) return null;
      final screenshot = LatestScreenshot.fromMap(result);
      if (screenshot.uri.isEmpty || screenshot.cachePath.isEmpty) return null;
      return screenshot;
    } on PlatformException catch (error) {
      debugPrint('latest screenshot lookup failed: ${error.code}');
      return null;
    } on MissingPluginException {
      return null;
    }
  }
}
