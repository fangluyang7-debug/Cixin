import 'package:flutter/material.dart';

import '../services/product_app_jump_service.dart';

class ProductAppJumpButton extends StatefulWidget {
  const ProductAppJumpButton({
    required this.platform,
    required this.productId,
    this.productUrl,
    this.brandId,
    this.compact = false,
    this.client,
    super.key,
  });

  final String platform;
  final String? productId;
  final String? productUrl;
  final String? brandId;
  final bool compact;
  final ProductAppJumpClient? client;

  @override
  State<ProductAppJumpButton> createState() => _ProductAppJumpButtonState();
}

class _ProductAppJumpButtonState extends State<ProductAppJumpButton> {
  bool _launching = false;

  Future<void> _launch() async {
    if (_launching) return;
    setState(() => _launching = true);
    final client = widget.client ?? ProductAppJumpService.instance;
    final support = client.supportFor(widget.platform);
    ProductAppJumpResult result;
    try {
      result = await client.launchProduct(
        ProductAppJumpRequest(
          platform: widget.platform,
          productId: widget.productId,
          productUrl: widget.productUrl,
          brandId: widget.brandId,
        ),
      );
    } catch (_) {
      result = const ProductAppJumpResult(
        ProductAppJumpStatus.launchFailed,
      );
    }
    if (!mounted) return;
    setState(() => _launching = false);
    if (result.launched) return;

    final message = switch (result.status) {
      ProductAppJumpStatus.productIdMissing =>
        '缺少平台商品 ID，无法打开${support.appLabel} App。',
      ProductAppJumpStatus.platformUnsupported =>
        '暂不支持跳转到${support.appLabel} App。',
      ProductAppJumpStatus.appUnavailable =>
        '未检测到${support.appLabel} App，或该 App 不支持此商品链接。',
      ProductAppJumpStatus.launchFailed =>
        '打开${support.appLabel} App 失败，请稍后重试。',
      ProductAppJumpStatus.launched => '',
    };
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final client = widget.client ?? ProductAppJumpService.instance;
    final support = client.supportFor(widget.platform);
    if (!support.supported) return const SizedBox.shrink();

    final label = '去${support.appLabel} App 查看';
    if (widget.compact) {
      return SizedBox(
        width: double.infinity,
        height: 30,
        child: FilledButton(
          key: const ValueKey('product-app-jump-button'),
          onPressed: _launching ? null : _launch,
          style: FilledButton.styleFrom(
            minimumSize: Size.zero,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            visualDensity: VisualDensity.compact,
            textStyle: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
            ),
          ),
          child: Text(
            _launching ? '正在打开...' : label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      );
    }

    return FilledButton.icon(
      key: const ValueKey('product-app-jump-button'),
      onPressed: _launching ? null : _launch,
      icon: _launching
          ? const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.open_in_new_rounded, size: 16),
      label: Text(_launching ? '正在打开...' : label),
    );
  }
}
