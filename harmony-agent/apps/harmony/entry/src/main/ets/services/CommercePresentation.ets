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
  return kind === FeedbackKind.RESPONSE_TIME ? '刚才等待结果的时间可以接受吗？' : '这次结果符合你的需求吗？';
}
export function feedbackLabel(option: FeedbackOption): string {
  switch (option) {
    case FeedbackOption.FAST: return '很快';
    case FeedbackOption.ACCEPTABLE: return '能接受';
    case FeedbackOption.SLOW: return '有点慢';
    case FeedbackOption.NO_RESULT: return '一直没出来';
    case FeedbackOption.USEFUL: return '有用';
    case FeedbackOption.INACCURATE: return '不够准确';
    case FeedbackOption.IRRELEVANT: return '无关';
    default: return '其他';
  }
}
export function feedbackReceiptText(receipt: FeedbackReceipt): string {
  if (!receipt.accepted) { return '本次反馈未接收，邀请可能已过期或已回答。'; }
  if (receipt.effect === 'RECORDED_ONLY') { return '已记录这次体验，但暂不用于当前策略校准。'; }
  if (receipt.effect === 'COLLECTING') { return '已记录这次体验，积累更多回答后再调整调度。'; }
  return '已记录这次体验，后续调度会继续经过设备状态和安全边界校验。';
}
