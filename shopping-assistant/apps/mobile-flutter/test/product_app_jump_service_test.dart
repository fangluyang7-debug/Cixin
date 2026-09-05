import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shopping_assistant_mobile/core/services/product_app_jump_service.dart';

void main() {
  group('ProductAppJumpService', () {
    test('reports only JD, Taobao and Tmall as supported', () {
      final service = ProductAppJumpService(
        launcher: _FakeIntentLauncher(resolve: (_) => true),
      );

      expect(service.supportFor('jd').supported, isTrue);
      expect(service.supportFor('taobao').supported, isTrue);
      expect(service.supportFor('tmall').supported, isTrue);
      expect(service.supportFor('vipshop').supported, isFalse);
      expect(service.supportFor('suning').supported, isFalse);
    });

    test('builds the verified package-bound JD product detail intent',
        () async {
      final launcher = _FakeIntentLauncher(resolve: (_) => true);
      final service = ProductAppJumpService(launcher: launcher);

      final result = await service.launchProduct(
        const ProductAppJumpRequest(
          platform: 'jd',
          productId: '100012345678',
        ),
      );

      expect(result.status, ProductAppJumpStatus.launched);
      expect(launcher.launched, hasLength(1));
      expect(launcher.launched.single.packageName, 'com.jingdong.app.mall');
      final uri = Uri.parse(launcher.launched.single.data);
      expect(uri.scheme, 'openapp.jdmobile');
      expect(uri.host, 'virtual');
      expect(
        jsonDecode(uri.queryParameters['params']!)['skuId'],
        '100012345678',
      );
    });

    test('builds the verified Taobao product detail intent', () async {
      final launcher = _FakeIntentLauncher(resolve: (_) => true);
      final service = ProductAppJumpService(launcher: launcher);

      final result = await service.launchProduct(
        const ProductAppJumpRequest(
          platform: 'taobao',
          productId: '123456789',
        ),
      );

      expect(result.status, ProductAppJumpStatus.launched);
      expect(
        launcher.resolutionAttempts.map((item) => item.data),
        ['taobao://item.taobao.com/item.htm?id=123456789'],
      );
      expect(launcher.launched.single.packageName, 'com.taobao.taobao');
    });

    test('recovers a missing Taobao item ID from the product URL', () async {
      final launcher = _FakeIntentLauncher(resolve: (_) => true);
      final service = ProductAppJumpService(launcher: launcher);

      final result = await service.launchProduct(
        const ProductAppJumpRequest(
          platform: 'taobao',
          productId: null,
          productUrl:
              'https://item.taobao.com/item.htm?id=842374918464&skuId=5616519337396',
        ),
      );

      expect(result.status, ProductAppJumpStatus.launched);
      expect(
        launcher.launched.single.data,
        'taobao://item.taobao.com/item.htm?id=842374918464',
      );
    });

    test('prefers the URL item ID over a legacy Taobao SKU ID', () async {
      final launcher = _FakeIntentLauncher(resolve: (_) => true);
      final service = ProductAppJumpService(launcher: launcher);

      final result = await service.launchProduct(
        const ProductAppJumpRequest(
          platform: 'taobao',
          productId: '5616519337396',
          productUrl:
              'https://item.taobao.com/item.htm?id=842374918464&skuId=5616519337396',
        ),
      );

      expect(result.status, ProductAppJumpStatus.launched);
      expect(
        launcher.launched.single.data,
        'taobao://item.taobao.com/item.htm?id=842374918464',
      );
    });

    test('builds the verified Tmall detail intent for the Taobao App',
        () async {
      final launcher = _FakeIntentLauncher(resolve: (_) => true);
      final service = ProductAppJumpService(launcher: launcher);

      final result = await service.launchProduct(
        const ProductAppJumpRequest(
          platform: 'tmall',
          productId: '123456789',
        ),
      );

      expect(result.status, ProductAppJumpStatus.launched);
      expect(
        launcher.resolutionAttempts.map((item) => item.data),
        ['taobao://detail.tmall.com/item.htm?id=123456789'],
      );
      expect(launcher.launched.single.packageName, 'com.taobao.taobao');
    });

    test('rejects a missing product ID before invoking Android intents',
        () async {
      final launcher = _FakeIntentLauncher(resolve: (_) => true);
      final service = ProductAppJumpService(launcher: launcher);

      final result = await service.launchProduct(
        const ProductAppJumpRequest(platform: 'taobao', productId: '  '),
      );

      expect(result.status, ProductAppJumpStatus.productIdMissing);
      expect(launcher.resolutionAttempts, isEmpty);
      expect(launcher.launched, isEmpty);
    });

    test('does not recover an ID from a non-product Taobao URL', () async {
      final launcher = _FakeIntentLauncher(resolve: (_) => true);
      final service = ProductAppJumpService(launcher: launcher);

      final result = await service.launchProduct(
        const ProductAppJumpRequest(
          platform: 'taobao',
          productId: null,
          productUrl: 'https://s.taobao.com/search?id=842374918464',
        ),
      );

      expect(result.status, ProductAppJumpStatus.productIdMissing);
      expect(launcher.resolutionAttempts, isEmpty);
    });

    test('rejects Vipshop, Suning and unknown platforms without an intent',
        () async {
      final launcher = _FakeIntentLauncher(resolve: (_) => true);
      final service = ProductAppJumpService(launcher: launcher);

      for (final platform in ['vipshop', 'suning', 'pdd']) {
        final result = await service.launchProduct(
          ProductAppJumpRequest(
            platform: platform,
            productId: '123456',
          ),
        );
        expect(result.status, ProductAppJumpStatus.platformUnsupported);
      }

      expect(launcher.resolutionAttempts, isEmpty);
      expect(launcher.launched, isEmpty);
    });

    test('returns appUnavailable when the target App cannot resolve the URI',
        () async {
      final launcher = _FakeIntentLauncher(resolve: (_) => false);
      final service = ProductAppJumpService(launcher: launcher);

      final result = await service.launchProduct(
        const ProductAppJumpRequest(
          platform: 'taobao',
          productId: '123456789',
        ),
      );

      expect(result.status, ProductAppJumpStatus.appUnavailable);
      expect(launcher.launched, isEmpty);
    });

    test('returns launchFailed instead of throwing when Android launch fails',
        () async {
      final launcher = _FakeIntentLauncher(
        resolve: (_) => true,
        throwOnLaunch: true,
      );
      final service = ProductAppJumpService(launcher: launcher);

      final result = await service.launchProduct(
        const ProductAppJumpRequest(
          platform: 'taobao',
          productId: '123456789',
        ),
      );

      expect(result.status, ProductAppJumpStatus.launchFailed);
      expect(launcher.launched, hasLength(1));
    });
  });
}

class _IntentAttempt {
  const _IntentAttempt({required this.packageName, required this.data});

  final String packageName;
  final String data;
}

class _FakeIntentLauncher implements ProductAppIntentLauncher {
  _FakeIntentLauncher({
    required this.resolve,
    this.throwOnLaunch = false,
  });

  final bool Function(_IntentAttempt attempt) resolve;
  final bool throwOnLaunch;
  final List<_IntentAttempt> resolutionAttempts = [];
  final List<_IntentAttempt> launched = [];

  @override
  Future<bool> canResolve({
    required String packageName,
    required String data,
  }) async {
    final attempt = _IntentAttempt(packageName: packageName, data: data);
    resolutionAttempts.add(attempt);
    return resolve(attempt);
  }

  @override
  Future<void> launch({
    required String packageName,
    required String data,
  }) async {
    launched.add(_IntentAttempt(packageName: packageName, data: data));
    if (throwOnLaunch) throw StateError('intent launch failed');
  }
}
