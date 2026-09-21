import { Product } from '../models/Product';
import { priceLabel, platformLabel } from '../services/CommercePresentation';

@Component
export struct CommerceIconButton {
  @Prop icon: Resource = $r('sys.media.ohos_ic_public_more');
  @Prop label: string = '';
  @Prop dark: boolean = false;
  action: () => void = () => {};
  build() {
    Button({ type: ButtonType.Circle }) {
      Image(this.icon).width(21).height(21).fillColor(this.dark ? '#FFFFFF' : '#1A1C1C')
    }.width(42).height(42).backgroundColor(this.dark ? '#111111' : '#F3F3F3')
      .accessibilityText(this.label).onClick(this.action)
  }
}

@Component
export struct ProductTile {
  @Prop product: Product;
  @Prop saved: boolean = false;
  onOpen: (product: Product) => void = () => {};
  onSave: (product: Product) => void = () => {};
  build() {
    Column({ space: 8 }) {
      Stack({ alignContent: Alignment.TopStart }) {
        Image($r('sys.media.ohos_ic_public_albums')).width(40).height(40).fillColor('#747878').align(Alignment.Center)
        if (this.product.imageUrl.length > 0) {
          Image(this.product.imageUrl).width('100%').height('100%').objectFit(ImageFit.Contain)
        }
        Text(platformLabel(this.product.platform)).fontSize(10).fontColor('#00513F').backgroundColor('#D7F8ED')
          .padding({ left: 7, right: 7, top: 4, bottom: 4 }).borderRadius(8).margin(8).maxLines(1)
      }.width('100%').aspectRatio(1).backgroundColor('#EEEEEE').borderRadius(8).clip(true)
        .onClick(() => this.onOpen(this.product))
      Text(this.product.title).fontSize(14).fontWeight(FontWeight.Bold).maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis }).height(40).width('100%').onClick(() => this.onOpen(this.product))
      Row({ space: 4 }) {
        Text(priceLabel(this.product)).fontSize(19).fontWeight(FontWeight.Bold).fontColor('#A14000')
          .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Button({ type: ButtonType.Circle }) {
          Image(this.saved ? $r('sys.media.ohos_ic_public_ok') : $r('sys.media.ohos_ic_public_add'))
            .width(18).height(18).fillColor(this.saved ? '#00513F' : '#1A1C1C')
        }.width(36).height(36).backgroundColor(this.saved ? '#D7F8ED' : '#F3F3F3')
          .accessibilityText(this.saved ? '移出清单' : '加入清单').onClick(() => this.onSave(this.product))
      }.width('100%')
      Text(this.product.shopName || '店铺未提供').fontSize(11).fontColor('#747878').width('100%')
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
    }.width('100%').padding(8).borderRadius(8).backgroundColor('#FFFFFF')
  }
}
