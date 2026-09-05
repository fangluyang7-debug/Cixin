import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shopping_assistant_mobile/core/services/product_app_jump_service.dart';
import 'package:shopping_assistant_mobile/core/widgets/product_app_jump_button.dart';
import 'package:shopping_assistant_mobile/main.dart';

void main() {
  test('detail data preserves product URL fallback inputs', () {
    final candidate = _candidate(platform: 'taobao');
    final detail = FigmaProductDetailData.from(
      candidate: candidate,
      detail: null,
      sessionId: 'session-1',
    );

    expect(detail.platform, 'taobao');
    expect(detail.platformProductId, '123456789');
    expect(
      detail.productUrl,
      'https://item.taobao.com/item.htm?id=123456789',
    );
  });

  testWidgets('preview result cards do not show App jump buttons',
      (tester) async {
    await tester.pumpWidget(
      _testShell(
        SizedBox(
          width: 163,
          height: 292,
          child: FigmaResultProductCard(
            candidate: _candidate(platform: 'tmall'),
          ),
        ),
      ),
    );

    expect(find.byKey(const ValueKey('product-app-jump-button')), findsNothing);
    expect(find.textContaining('App 查看'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('JD and Taobao use their platform-specific labels',
      (tester) async {
    await tester.pumpWidget(
      _testShell(
        Column(
          children: [
            ProductAppJumpButton(
              platform: 'jd',
              productId: '100012345678',
              client: _FakeJumpClient(ProductAppJumpStatus.launched),
            ),
            ProductAppJumpButton(
              platform: 'taobao',
              productId: '123456789',
              client: _FakeJumpClient(ProductAppJumpStatus.launched),
            ),
          ],
        ),
      ),
    );

    expect(find.text('去京东 App 查看'), findsOneWidget);
    expect(find.text('去淘宝 App 查看'), findsOneWidget);
  });

  testWidgets('Vipshop and Suning do not show App jump buttons',
      (tester) async {
    await tester.pumpWidget(
      _testShell(
        Column(
          children: [
            ProductAppJumpButton(
              platform: 'vipshop',
              productId: '691234567890',
              client: ProductAppJumpService(
                launcher: _FakeIntentLauncher(resolve: true),
              ),
            ),
            ProductAppJumpButton(
              platform: 'suning',
              productId: '105828924',
              client: ProductAppJumpService(
                launcher: _FakeIntentLauncher(resolve: true),
              ),
            ),
          ],
        ),
      ),
    );

    expect(
      find.byKey(const ValueKey('product-app-jump-button')),
      findsNothing,
    );
    expect(find.textContaining('App 查看'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('missing product ID shows a SnackBar', (tester) async {
    final launcher = _FakeIntentLauncher(resolve: false);
    await tester.pumpWidget(
      _testShell(
        ProductAppJumpButton(
          platform: 'jd',
          productId: null,
          client: ProductAppJumpService(launcher: launcher),
        ),
      ),
    );

    await tester.tap(find.byKey(const ValueKey('product-app-jump-button')));
    await tester.pump();

    expect(find.text('缺少平台商品 ID，无法打开京东 App。'), findsOneWidget);
    expect(launcher.calls, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('uninstalled supported App does not crash and shows a SnackBar',
      (tester) async {
    await tester.pumpWidget(
      _testShell(
        ProductAppJumpButton(
          platform: 'taobao',
          productId: '123456789',
          client: ProductAppJumpService(
            launcher: _FakeIntentLauncher(resolve: false),
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const ValueKey('product-app-jump-button')));
    await tester.pump();

    expect(
      find.text('未检测到淘宝 App，或该 App 不支持此商品链接。'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('unexpected service errors become a failure SnackBar',
      (tester) async {
    await tester.pumpWidget(
      _testShell(
        ProductAppJumpButton(
          platform: 'taobao',
          productId: '123456789',
          client: _ThrowingJumpClient(),
        ),
      ),
    );

    await tester.tap(find.byKey(const ValueKey('product-app-jump-button')));
    await tester.pump();

    expect(find.text('打开淘宝 App 失败，请稍后重试。'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

Widget _testShell(Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: Center(child: child),
    ),
  );
}

DemoCandidate _candidate({required String platform}) {
  return DemoCandidate(
    candidateItemId: 'candidate-1',
    title: '测试商品',
    platform: platform,
    amount: 399,
    productUrl: platform == 'tmall'
        ? 'https://detail.tmall.com/item.htm?id=123456789'
        : 'https://item.taobao.com/item.htm?id=123456789',
    platformProductId: '123456789',
    stockStatus: StockStatus.inStock,
    reason: '视觉匹配',
    matchScore: 0.91,
    rating: 4.8,
    material: '测试材质',
    materialScore: 90,
    breathabilityScore: 80,
    dailyScore: 88,
    decisionTags: const ['相似'],
    detailBullets: const ['测试'],
    accentColor: const Color(0xFF8BFFD9),
  );
}

class _FakeJumpClient implements ProductAppJumpClient {
  _FakeJumpClient(this.status);

  final ProductAppJumpStatus status;
  final List<ProductAppJumpRequest> requests = [];

  @override
  ProductAppJumpSupport supportFor(String platform) {
    return ProductAppJumpService.instance.supportFor(platform);
  }

  @override
  Future<ProductAppJumpResult> launchProduct(
    ProductAppJumpRequest request,
  ) async {
    requests.add(request);
    return ProductAppJumpResult(status);
  }
}

class _ThrowingJumpClient implements ProductAppJumpClient {
  @override
  ProductAppJumpSupport supportFor(String platform) {
    return ProductAppJumpService.instance.supportFor(platform);
  }

  @override
  Future<ProductAppJumpResult> launchProduct(
    ProductAppJumpRequest request,
  ) {
    throw StateError('unexpected service error');
  }
}

class _FakeIntentLauncher implements ProductAppIntentLauncher {
  _FakeIntentLauncher({required this.resolve});

  final bool resolve;
  int calls = 0;

  @override
  Future<bool> canResolve({
    required String packageName,
    required String data,
  }) async {
    calls += 1;
    return resolve;
  }

  @override
  Future<void> launch({
    required String packageName,
    required String data,
  }) async {}
}
