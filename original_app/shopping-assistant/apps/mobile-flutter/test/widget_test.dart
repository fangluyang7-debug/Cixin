import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shopping_assistant_mobile/main.dart';

void main() {
  test('candidate matching sort ignores platform and price', () {
    final candidates = [
      _candidate(id: 'taobao-low', platform: 'taobao', score: 0.81, amount: 99),
      _candidate(id: 'jd-best', platform: 'jd', score: 0.95, amount: 999),
      _candidate(id: 'dewu-mid', platform: 'dewu', score: 0.88, amount: 199),
    ]..sort(compareCandidatesByMatch);

    expect(
      candidates.map((candidate) => candidate.candidateItemId),
      ['jd-best', 'dewu-mid', 'taobao-low'],
    );
  });

  testWidgets('ranked result list does not create platform sections',
      (WidgetTester tester) async {
    final candidates = [
      _candidate(
        id: 'taobao-best',
        platform: 'taobao',
        score: 0.95,
        amount: 999,
      ),
      _candidate(id: 'jd-mid', platform: 'jd', score: 0.88, amount: 199),
      _candidate(
        id: 'taobao-low',
        platform: 'taobao',
        score: 0.81,
        amount: 99,
      ),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ListView(
            children: [
              RankedStreamedCandidateList(
                candidates: candidates,
                isStreaming: false,
                shimmer: 0,
                onOpen: (_) {},
                onPay: (_) {},
                onShortlist: (_) {},
              ),
            ],
          ),
        ),
      ),
    );

    final renderedIds = tester
        .widgetList<AnimatedProductCard>(find.byType(AnimatedProductCard))
        .map((card) => card.candidate.candidateItemId);
    expect(renderedIds, ['taobao-best', 'jd-mid', 'taobao-low']);
    expect(find.text('淘宝 结果'), findsNothing);
    expect(find.text('京东 结果'), findsNothing);
  });

  testWidgets('shows chat composer actions', (WidgetTester tester) async {
    await tester.pumpWidget(const ShoppingAssistantApp());

    expect(find.text('SoleAI'), findsWidgets);
    expect(find.text('拍照或描述需求，帮您寻找商品'), findsNothing);
    expect(find.text('今天想找什么？'), findsOneWidget);
    expect(find.text('拍鞋找同款'), findsOneWidget);
    expect(find.text('历史最低价'), findsNothing);
    expect(find.text('降价提醒'), findsNothing);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Icon &&
            (widget.icon == Icons.camera_alt ||
                widget.icon == Icons.camera_alt_outlined),
      ),
      findsWidgets,
    );
    expect(find.byIcon(Icons.mic_rounded), findsOneWidget);
  });
}

DemoCandidate _candidate({
  required String id,
  required String platform,
  required double score,
  required double amount,
}) {
  return DemoCandidate(
    candidateItemId: id,
    title: id,
    platform: platform,
    amount: amount,
    stockStatus: StockStatus.inStock,
    reason: 'test',
    matchScore: score,
    rating: 4.5,
    material: 'test',
    materialScore: 80,
    breathabilityScore: 80,
    dailyScore: 80,
    decisionTags: const [],
    detailBullets: const [],
    accentColor: Colors.orange,
  );
}
