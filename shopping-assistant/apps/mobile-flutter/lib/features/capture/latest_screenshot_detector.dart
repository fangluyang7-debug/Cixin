import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../core/local/local_json_store.dart';
import '../../core/services/latest_screenshot_service.dart';

typedef LatestScreenshotDetected = FutureOr<bool> Function(
  LatestScreenshot screenshot,
);

class LatestScreenshotDetector with WidgetsBindingObserver {
  LatestScreenshotDetector({
    required LatestScreenshotDetected onDetected,
    LatestScreenshotService service = const LatestScreenshotService(),
    LocalJsonStore store = const LocalJsonStore(
      'latest_screenshot_detector_v1.json',
    ),
  })  : _onDetected = onDetected,
        _service = service,
        _store = store;

  final LatestScreenshotDetected _onDetected;
  final LatestScreenshotService _service;
  final LocalJsonStore _store;
  final Set<String> _suppressedKeys = <String>{};
  final Set<String> _promptedKeys = <String>{};
  bool _started = false;
  bool _isChecking = false;

  Future<void> start() async {
    if (_started) return;
    _started = true;
    WidgetsBinding.instance.addObserver(this);
    await _loadSuppressedKeys();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(checkNow());
    });
  }

  void dispose() {
    if (!_started) return;
    WidgetsBinding.instance.removeObserver(this);
    _started = false;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(checkNow());
    }
  }

  Future<void> checkNow() async {
    if (_isChecking) return;
    _isChecking = true;
    try {
      const retryDelays = <Duration>[
        Duration.zero,
        Duration(milliseconds: 300),
        Duration(milliseconds: 800),
      ];
      for (final delay in retryDelays) {
        if (delay > Duration.zero) {
          await Future<void>.delayed(delay);
        }
        final screenshot = await _service.findLatestScreenshot();
        if (screenshot == null) continue;
        final key = screenshot.dedupeKey;
        if (_suppressedKeys.contains(key) || _promptedKeys.contains(key)) {
          continue;
        }
        final accepted = await _onDetected(screenshot);
        if (accepted) {
          _promptedKeys.add(key);
          return;
        }
      }
    } finally {
      _isChecking = false;
    }
  }

  Future<void> suppress(LatestScreenshot screenshot) async {
    final key = screenshot.dedupeKey;
    _promptedKeys.add(key);
    if (!_suppressedKeys.add(key)) return;
    await _persistSuppressedKeys();
  }

  Future<void> _loadSuppressedKeys() async {
    final stored = await _store.read();
    final keys = stored['keys'];
    if (keys is! List) return;
    _suppressedKeys
      ..clear()
      ..addAll(
        keys
            .map((item) => item?.toString().trim())
            .whereType<String>()
            .where((item) => item.isNotEmpty),
      );
  }

  Future<void> _persistSuppressedKeys() async {
    await _store.write({
      'version': 1,
      'keys': _suppressedKeys.take(80).toList(growable: false),
      'updatedAt': DateTime.now().toIso8601String(),
    });
  }
}
