import { FeedbackKind, FeedbackOption, FeedbackReceipt } from 'scheduler';
import { Product } from '../models/Product';

export function cloudFailureText(reason?: string): string {
  switch (reason) {
    case 'CLOUD_API_NOT_CONFIGURED': return '请先在“我的”中配置云端地址';
    case 'CLOUD_GUEST_NOT_DEPLOYED': return '云端尚未更新免登录接口，请更新服务后重试';
    case 'CLOUD_GUEST_FAILED':
    case 'CLOUD_HTTP_401': return '云端连接身份暂不可用，请重试';
    case 'NETWORK_NOT_ALLOWED': return '当前任务未获网络访问授权';
    case 'NETWORK_CHANGED_DURING_PROBE':
    case 'REMOTE_ROUTE_CHANGED': return '网络连接已变化，请重试';
    case 'CLOUD_IMAGE_TOO_LARGE': return '图片为空或超过 6 MB，请重新选择';
    default: return '云端搜索未完成，请检查连接或稍后重试';
  }
}

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
