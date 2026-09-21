import { FeedbackKind, FeedbackOption, FeedbackReceipt } from 'scheduler';
import { Product } from '../models/Product';

export function productKey(product: Product): string { return `${product.platform}:${product.externalId}`; }
export function platformLabel(value: string): string {
  if (value === 'tb') { return '淘宝'; }
  if (value === 'jd') { return '京东'; }
  if (value === 'pdd') { return '拼多多'; }
  if (value === 'vip') { return '唯品会'; }
  return value || '来源未提供';
}
export function numericPrice(product: Product): number {
  const price = product.price.replace(/[,￥¥\s]/g, '');
  return /^\d+(\.\d+)?$/.test(price) ? Number(price) : Infinity;
}
export function priceLabel(product: Product): string {
  return Number.isFinite(numericPrice(product)) ? `${product.currency === 'CNY' || product.currency === '' ? '¥' : product.currency + ' '}${product.price}` : product.price || '暂无报价';
}
export function safeProductUrl(url: string): boolean {
  return /^https:\/\/[^\s/@:?#]+(?:[/?#][^\s]*)?$/i.test(url);
}
export function feedbackQuestion(kind: FeedbackKind): string {
  return kind === FeedbackKind.RESPONSE_TIME ? '这次搜索的响应速度如何？' :
    kind === FeedbackKind.RESULT_UTILITY ? '这次搜索结果对你有帮助吗？' : '这次任务的设备体验如何？';
}
export function feedbackLabel(option: FeedbackOption): string {
  switch (option) {
    case FeedbackOption.FAST: return '很快';
    case FeedbackOption.ACCEPTABLE: return '可接受';
    case FeedbackOption.SLOW: return '偏慢';
    case FeedbackOption.NO_RESULT: return '未得到结果';
    case FeedbackOption.USEFUL: return '有用';
    case FeedbackOption.INACCURATE: return '不够准确';
    case FeedbackOption.IRRELEVANT: return '无关';
    case FeedbackOption.COMFORTABLE: return '舒适';
    default: return '发热明显';
  }
}
export function feedbackReceiptText(receipt: FeedbackReceipt): string {
  if (!receipt.accepted) { return '本次反馈未接收，邀请可能已过期或已回答。'; }
  if (receipt.effect === 'RECORDED_ONLY') { return '已记录反馈；该样本不参与当前策略校准。'; }
  const after = receipt.after;
  if (receipt.effect === 'COLLECTING') {
    return `已记录。速度样本 ${after?.speedSamples ?? 0}，质量样本 ${after?.qualitySamples ?? 0}；各维度达到 ${receipt.minimumSamples} 条后校准。`;
  }
  const scope = receipt.mode === 'OBSERVE' ? '当前仅观察，不改变执行配置。' :
    receipt.mode === 'SHADOW' ? '当前仅影子评估，不改变执行配置。' : '后续任务仍须通过配置验证、质量和冷却门槛。';
  return `已校准：时延权重 ${after?.latencyWeight.toFixed(1)}，质量权重 ${after?.qualityWeight.toFixed(1)}。${scope}`;
}
