import { Product } from '../models/Product';
import { priceLabel, platformLabel } from '../services/CommercePresentation';

@Component
export struct ProductDetail {
  @Prop product: Product;
  build() {
    Column({ space: 22 }) {
      Stack() {
        Image($r('sys.media.ohos_ic_public_albums')).width(48).height(48).fillColor('#747878')
        if (this.product.imageUrl !== '') {
          Image(this.product.imageUrl).width('100%').height('100%').objectFit(ImageFit.Contain)
        }
      }.width('100%').aspectRatio(1).backgroundColor('#FFFFFF').borderRadius(8).clip(true)
      Text(this.product.title).fontSize(24).fontWeight(FontWeight.Bold).width('100%')
      Text(priceLabel(this.product)).fontSize(30).fontWeight(FontWeight.Bold).fontColor('#A14000').width('100%')
      Text(`商品编号 ${this.product.externalId}`).fontSize(11).fontColor('#747878').width('100%')
      Divider().color('#E2E2E2')
      Row({ space: 16 }) {
        Column({ space: 8 }) {
          Text('库存记录').fontSize(12).fontColor('#747878')
          Text(this.product.stockStatus || '暂无库存数据').fontSize(16).fontWeight(FontWeight.Medium)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Column({ space: 8 }) {
          Text(platformLabel(this.product.platform)).fontSize(12).fontColor('#009576')
          Text(this.product.shopName || '店铺未提供').fontSize(16).fontWeight(FontWeight.Medium)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%')
      Divider().color('#E2E2E2')
      Text('价格趋势').fontSize(18).fontWeight(FontWeight.Bold).width('100%')
      Text('暂无历史价格数据').fontSize(14).fontColor('#747878').width('100%').padding({ top: 24, bottom: 24 })
      Divider().color('#E2E2E2')
      Text('数据来源').fontSize(18).fontWeight(FontWeight.Bold).width('100%')
      Text('本地商品数据集，非实时平台报价。价格与库存以商品来源页面为准。')
        .fontSize(13).fontColor('#747878').width('100%')
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
