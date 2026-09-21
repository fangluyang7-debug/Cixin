import { Product } from '../models/Product';
import { ProductTile } from './CommerceControls';
import { productKey } from '../services/CommercePresentation';

@Component
export struct SearchResults {
  @Prop products: Product[] = [];
  @Prop savedKeys: string[] = [];
  @Prop query: string = '';
  @Prop summary: string = '';
  @Prop plan: string = '';
  @Prop busy: boolean = false;
  @Prop photoUri: string = '';
  @Prop priceSorted: boolean = false;
  @Prop highQuality: boolean = false;
  onSort: () => void = () => {};
  onQuality: (value: boolean) => void = () => {};
  onOpen: (product: Product) => void = () => {};
  onSave: (product: Product) => void = () => {};
  onRetry: () => void = () => {};
  onCancel: () => void = () => {};
  onPhoto: () => void = () => {};
  build() {
    Column({ space: 16 }) {
      if (this.photoUri !== '') {
        Column({ space: 8 }) {
          Image(this.photoUri).width('100%').height(190).objectFit(ImageFit.Contain).backgroundColor('#EEEEEE')
          Row() {
            Text('已选图片 · 尚未接入图像识别').fontSize(12).fontColor('#444748').layoutWeight(1)
            Button('重选').fontSize(12).height(32).fontColor('#00513F').backgroundColor('#D7F8ED').onClick(this.onPhoto)
          }.width('100%')
        }.width('100%')
      }
      Text(this.query || '比价雷达').fontSize(20).fontWeight(FontWeight.Bold).width('100%')
      Row({ space: 10 }) {
        if (this.busy) { LoadingProgress().width(24).height(24).color('#009576') }
        Text(this.summary).fontSize(14).fontColor('#444748').layoutWeight(1)
        if (this.busy) {
          Button('取消').fontSize(12).height(34).onClick(this.onCancel).backgroundColor('#EEEEEE').fontColor('#1A1C1C')
        }
      }.width('100%')
      if (this.plan !== '') { Text(this.plan).fontSize(11).fontColor('#747878').width('100%') }
      Row({ space: 8 }) {
        Button(this.priceSorted ? '价格从低到高' : '相关度排序').fontSize(12).height(36)
          .backgroundColor('#111111').fontColor('#FFFFFF').onClick(this.onSort)
        Blank()
        Text('高质量').fontSize(12)
        Toggle({ type: ToggleType.Switch, isOn: this.highQuality }).selectedColor('#009576').onChange(this.onQuality)
      }.width('100%')
      if (!this.busy && this.products.length === 0) {
        Column({ space: 16 }) {
          Image($r('sys.media.ohos_ic_public_search_filled')).width(36).height(36).fillColor('#747878')
          Text('暂无候选商品').fontSize(16).fontColor('#747878')
          if (this.query !== '') {
            Button('重新搜索').fontSize(13).backgroundColor('#111111').onClick(this.onRetry)
          }
        }.width('100%').padding({ top: 36, bottom: 36 })
      }
      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
        ForEach(this.products, (product: Product) => {
          Column() {
            ProductTile({ product: product, saved: this.savedKeys.indexOf(productKey(product)) >= 0,
              onOpen: this.onOpen, onSave: this.onSave })
          }.width('48%').margin({ bottom: 12 })
        }, productKey)
      }.width('100%')
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
