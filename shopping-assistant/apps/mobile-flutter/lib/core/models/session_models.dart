class Money {
  const Money({required this.amount, required this.currency});

  final String amount;
  final String currency;
}

class CandidateItemSummary {
  const CandidateItemSummary({
    required this.candidateItemId,
    required this.title,
    required this.platformName,
    required this.price,
    required this.stockStatus,
  });

  final String candidateItemId;
  final String title;
  final String platformName;
  final Money price;
  final String stockStatus;
}
