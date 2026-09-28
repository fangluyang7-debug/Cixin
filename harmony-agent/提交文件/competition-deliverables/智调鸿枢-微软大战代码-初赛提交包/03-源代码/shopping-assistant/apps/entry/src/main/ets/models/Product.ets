export class Product {
  public databaseId: number;
  public externalId: string;
  public platform: string;
  public title: string;
  public price: string;
  public currency: string;
  public stockStatus: string;
  public shopName: string;
  public shopType: string;
  public productUrl: string;
  public imageUrl: string;

  constructor(
    externalId: string,
    platform: string,
    title: string,
    price: string,
    currency: string,
    stockStatus: string,
    shopName: string,
    shopType: string,
    productUrl: string,
    imageUrl: string,
    databaseId: number = 0
  ) {
    this.databaseId = databaseId;
    this.externalId = externalId;
    this.platform = platform;
    this.title = title;
    this.price = price;
    this.currency = currency;
    this.stockStatus = stockStatus;
    this.shopName = shopName;
    this.shopType = shopType;
    this.productUrl = productUrl;
    this.imageUrl = imageUrl;
  }
}

export interface ProductJsonItem {
  externalId: string;
  platform: string;
  title: string;
  price: string;
  currency: string;
  stockStatus: string;
  shopName: string;
  shopType: string;
  productUrl: string;
  imageUrl: string;
}
