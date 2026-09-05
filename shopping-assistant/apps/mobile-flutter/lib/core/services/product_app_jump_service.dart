import 'dart:convert';
import 'dart:io';

import 'package:android_intent_plus/android_intent.dart';

enum ProductAppJumpStatus {
  launched,
  productIdMissing,
  platformUnsupported,
  appUnavailable,
  launchFailed,
}

class ProductAppJumpRequest {
  const ProductAppJumpRequest({
    required this.platform,
    required this.productId,
    this.productUrl,
    this.brandId,
  });

  final String platform;
  final String? productId;
  final String? productUrl;
  final String? brandId;
}

class ProductAppJumpResult {
  const ProductAppJumpResult(this.status);

  final ProductAppJumpStatus status;

  bool get launched => status == ProductAppJumpStatus.launched;
}

class ProductAppJumpSupport {
  const ProductAppJumpSupport({
    required this.supported,
    required this.appLabel,
  });

  final bool supported;
  final String appLabel;
}

abstract interface class ProductAppJumpClient {
  ProductAppJumpSupport supportFor(String platform);

  Future<ProductAppJumpResult> launchProduct(ProductAppJumpRequest request);
}

abstract interface class ProductAppIntentLauncher {
  Future<bool> canResolve({
    required String packageName,
    required String data,
  });

  Future<void> launch({
    required String packageName,
    required String data,
  });
}

class AndroidProductAppIntentLauncher implements ProductAppIntentLauncher {
  const AndroidProductAppIntentLauncher();

  @override
  Future<bool> canResolve({
    required String packageName,
    required String data,
  }) async {
    if (!Platform.isAndroid) return false;
    final intent = AndroidIntent(
      action: 'action_view',
      data: data,
      package: packageName,
    );
    return await intent.canResolveActivity() ?? false;
  }

  @override
  Future<void> launch({
    required String packageName,
    required String data,
  }) {
    if (!Platform.isAndroid) {
      throw UnsupportedError('PRODUCT_APP_JUMP_ANDROID_ONLY');
    }
    return AndroidIntent(
      action: 'action_view',
      data: data,
      package: packageName,
    ).launch();
  }
}

class ProductAppJumpService implements ProductAppJumpClient {
  ProductAppJumpService({
    ProductAppIntentLauncher launcher = const AndroidProductAppIntentLauncher(),
  }) : _launcher = launcher;

  static final ProductAppJumpService instance = ProductAppJumpService();

  final ProductAppIntentLauncher _launcher;

  @override
  ProductAppJumpSupport supportFor(String platform) {
    return switch (_normalizePlatform(platform)) {
      'jd' => const ProductAppJumpSupport(
          supported: true,
          appLabel: '京东',
        ),
      'taobao' => const ProductAppJumpSupport(
          supported: true,
          appLabel: '淘宝',
        ),
      'tmall' => const ProductAppJumpSupport(
          supported: true,
          appLabel: '淘宝/天猫',
        ),
      'vipshop' => const ProductAppJumpSupport(
          supported: false,
          appLabel: '唯品会',
        ),
      'suning' => const ProductAppJumpSupport(
          supported: false,
          appLabel: '苏宁',
        ),
      _ => const ProductAppJumpSupport(
          supported: false,
          appLabel: '平台',
        ),
    };
  }

  @override
  Future<ProductAppJumpResult> launchProduct(
    ProductAppJumpRequest request,
  ) async {
    final support = supportFor(request.platform);
    if (!support.supported) {
      return const ProductAppJumpResult(
        ProductAppJumpStatus.platformUnsupported,
      );
    }

    final normalizedPlatform = _normalizePlatform(request.platform);
    final productId = _productIdFromUrl(
          platform: normalizedPlatform,
          productUrl: request.productUrl,
        ) ??
        _cleanProductId(request.productId);
    if (productId == null || productId.isEmpty) {
      return const ProductAppJumpResult(
        ProductAppJumpStatus.productIdMissing,
      );
    }

    final target = _targetFor(request.platform);
    if (target == null) {
      return const ProductAppJumpResult(
        ProductAppJumpStatus.platformUnsupported,
      );
    }

    final links = target.links(
      productId,
      request.brandId?.trim(),
    );
    if (links.isEmpty) {
      return const ProductAppJumpResult(
        ProductAppJumpStatus.platformUnsupported,
      );
    }

    var resolvedAny = false;
    var launchFailed = false;
    for (final link in links) {
      try {
        final canResolve = await _launcher.canResolve(
          packageName: target.packageName,
          data: link,
        );
        if (!canResolve) continue;
        resolvedAny = true;
        try {
          await _launcher.launch(
            packageName: target.packageName,
            data: link,
          );
          return const ProductAppJumpResult(ProductAppJumpStatus.launched);
        } catch (_) {
          launchFailed = true;
        }
      } catch (_) {
        launchFailed = true;
      }
    }

    return ProductAppJumpResult(
      resolvedAny || launchFailed
          ? ProductAppJumpStatus.launchFailed
          : ProductAppJumpStatus.appUnavailable,
    );
  }

  _ProductAppTarget? _targetFor(String platform) {
    final normalized = _normalizePlatform(platform);
    if (normalized == 'jd') {
      return _ProductAppTarget(
        packageName: 'com.jingdong.app.mall',
        links: (productId, _) {
          final params = jsonEncode({
            'category': 'jump',
            'des': 'productDetail',
            'skuId': productId,
          });
          return [
            Uri(
              scheme: 'openapp.jdmobile',
              host: 'virtual',
              queryParameters: {'params': params},
            ).toString(),
          ];
        },
      );
    }
    if (normalized == 'taobao') {
      return _ProductAppTarget(
        packageName: 'com.taobao.taobao',
        links: (productId, _) => [
          Uri(
            scheme: 'taobao',
            host: 'item.taobao.com',
            path: '/item.htm',
            queryParameters: {'id': productId},
          ).toString(),
        ],
      );
    }
    if (normalized == 'tmall') {
      return _ProductAppTarget(
        packageName: 'com.taobao.taobao',
        links: (productId, _) => [
          Uri(
            scheme: 'taobao',
            host: 'detail.tmall.com',
            path: '/item.htm',
            queryParameters: {'id': productId},
          ).toString(),
        ],
      );
    }
    return null;
  }

  String _normalizePlatform(String platform) {
    final normalized = platform.trim().toLowerCase();
    if (normalized == 'jd' || normalized == 'jingdong' || normalized == '京东') {
      return 'jd';
    }
    if (normalized == 'taobao' || normalized == '淘宝') return 'taobao';
    if (normalized == 'tmall' || normalized == '天猫') return 'tmall';
    if (normalized == 'vipshop' || normalized == '唯品会') return 'vipshop';
    if (normalized == 'suning' || normalized == '苏宁') return 'suning';
    return normalized;
  }

  String? _productIdFromUrl({
    required String platform,
    required String? productUrl,
  }) {
    final rawUrl = productUrl?.trim();
    if (rawUrl == null || rawUrl.isEmpty) return null;

    final uri = Uri.tryParse(rawUrl);
    if (uri == null || !uri.hasScheme) return null;
    final host = uri.host.toLowerCase();

    if (platform == 'taobao' && host == 'item.taobao.com') {
      return _cleanProductId(uri.queryParameters['id']);
    }
    if (platform == 'tmall' && host == 'detail.tmall.com') {
      return _cleanProductId(uri.queryParameters['id']);
    }
    if (platform == 'jd' && (host == 'jd.com' || host.endsWith('.jd.com'))) {
      for (final segment in uri.pathSegments.reversed) {
        final candidate = segment.replaceFirst(RegExp(r'\.html?$'), '');
        if (RegExp(r'^\d{5,}$').hasMatch(candidate)) return candidate;
      }
      return _cleanProductId(
        uri.queryParameters['skuId'] ??
            uri.queryParameters['sku'] ??
            uri.queryParameters['wareId'],
      );
    }
    return null;
  }

  String? _cleanProductId(String? value) {
    final normalized = value?.trim();
    if (normalized == null ||
        normalized.isEmpty ||
        normalized.length > 128 ||
        !RegExp(r'^[a-zA-Z0-9_-]+$').hasMatch(normalized)) {
      return null;
    }
    return normalized;
  }
}

class _ProductAppTarget {
  const _ProductAppTarget({
    required this.packageName,
    required this.links,
  });

  final String packageName;
  final List<String> Function(String productId, String? brandId) links;
}
