// Generated from contracts/shopping/v1/schemas.json; run npm run contracts:generate.
export interface ShoppingQueryV1FiltersPreferences {
  freeShipping?: boolean | null;
  shopTypes?: Array<string> | null;
  brands?: Array<string> | null;
  colors?: Array<string> | null;
  platforms?: Array<string> | null;
  priceDirection?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingQueryV1Filters {
  priceMin?: string | number | null;
  priceMax?: string | number | null;
  priceTarget?: string | number | null;
  priceTolerance?: string | number | null;
  timeConstraintDays?: number | null;
  sizeMin?: number | null;
  sizeMax?: number | null;
  stockOnly?: boolean | null;
  freeShippingOnly?: boolean | null;
  urgentDeliveryPreferred?: boolean | null;
  sizeSystem?: string | null;
  shopType?: string | null;
  categoryScope?: string | null;
  platformsInclude?: Array<string> | null;
  platformsExclude?: Array<string> | null;
  brandsInclude?: Array<string> | null;
  brandsExclude?: Array<string> | null;
  colorsInclude?: Array<string> | null;
  colorsExclude?: Array<string> | null;
  sizesInclude?: Array<string> | null;
  excludedProductIds?: Array<string> | null;
  excludedCandidateItemIds?: Array<string> | null;
  sortRule?: string | null;
  preferences?: ShoppingQueryV1FiltersPreferences | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingQueryV1ImageArtifact {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingQueryV1ImageRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingQueryV1InitialSubjectSelectionBox {
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  confidence?: number | null;
  label?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingQueryV1InitialSubjectSelection {
  box?: ShoppingQueryV1InitialSubjectSelectionBox | null;
  selectionSource?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingQueryV1 {
  operation: string | null;
  message?: string | null;
  entrySource?: string | null;
  categoryHint?: string | null;
  sessionId?: string | null;
  assetId?: string | null;
  selectionSource?: string | null;
  sortPreference?: string | null;
  keywords?: Array<string> | null;
  filters?: ShoppingQueryV1Filters | null;
  imageArtifact?: ShoppingQueryV1ImageArtifact | null;
  imageRef?: ShoppingQueryV1ImageRef | null;
  initialSubjectSelection?: ShoppingQueryV1InitialSubjectSelection | null;
  highQuality?: boolean | null;
  baseVersion?: number | null;
  requestRevision?: number | null;
  idempotencyKey?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingImageV1PrivateLocator {
  bucketGroup?: string | null;
  objectKey?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingImageV1 {
  assetId: string | null;
  owner?: string | null;
  assetGroupId?: string | null;
  variantType?: string | null;
  sourceType?: string | null;
  uploadStatus?: string | null;
  mediaType?: string | null;
  contentHash?: string | null;
  isPrimaryRecognitionAsset?: boolean | null;
  width?: number | null;
  height?: number | null;
  orientation?: number | null;
  sizeBytes?: number | null;
  privateLocator?: ShoppingImageV1PrivateLocator | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingPreprocessV1OriginalRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingPreprocessV1CropRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingPreprocessV1SelectedBox {
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  confidence?: number | null;
  label?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingPreprocessV1DetectedBoxesItem {
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  confidence?: number | null;
  label?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingPreprocessV1 {
  originalRef?: ShoppingPreprocessV1OriginalRef | null;
  cropRef?: ShoppingPreprocessV1CropRef | null;
  selectedBox?: ShoppingPreprocessV1SelectedBox | null;
  detectedBoxes?: Array<ShoppingPreprocessV1DetectedBoxesItem> | null;
  selectionSource?: string | null;
  status?: string | null;
  transformVersion?: string | null;
  encoding?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  targetSize?: number | null;
  jpegQuality?: number | null;
  paddingRatio?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingQualityV1 {
  method: string | null;
  reason?: string | null;
  width?: number | null;
  height?: number | null;
  decodable?: boolean | null;
  passed: boolean | null;
  thresholds?: Object | null;
  sharpness?: number | null;
  subjectVisibility?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingProfileV1 {
  category: string | null;
  brand?: string | null;
  modelLine?: string | null;
  colorFamily?: string | null;
  colorway?: string | null;
  shoeType?: string | null;
  size?: string | null;
  color?: string | null;
  modelVersion?: string | null;
  profileVersion?: string | null;
  styleTags?: Array<string> | null;
  sceneTags?: Array<string> | null;
  keywords?: Array<string> | null;
  confidence?: number | null;
  raw?: Object | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingEmbeddingV1VectorRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingEmbeddingV1 {
  provider?: string | null;
  modelName?: string | null;
  modelId?: string | null;
  modelVersion?: string | null;
  modelHash?: string | null;
  vectorHash?: string | null;
  embeddingKind: string | null;
  dtype?: string | null;
  normalization?: string | null;
  preprocessVersion?: string | null;
  indexSpaceId?: string | null;
  dimension: number | null;
  vectorRef?: ShoppingEmbeddingV1VectorRef | null;
  vector?: Array<number> | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingProductV1 {
  productId: string | null;
  externalId?: string | null;
  platform?: string | null;
  title: string | null;
  currency?: string | null;
  stockStatus?: string | null;
  shopName?: string | null;
  shopType?: string | null;
  productUrl?: string | null;
  sourceImageUrl?: string | null;
  imageBucketGroup?: string | null;
  imageObjectKey?: string | null;
  imagePublicUrl?: string | null;
  tagStatus?: string | null;
  brand?: string | null;
  category?: string | null;
  modelLine?: string | null;
  colorFamily?: string | null;
  colorway?: string | null;
  shoeType?: string | null;
  importBatchId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  priceAmount?: string | number | null;
  keywords?: Array<string> | null;
  normalizedTags?: Object | null;
  rawPayload?: Object | null;
  tagConfidence?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateV1Price {
  amount?: string | number | null;
  currency?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateV1CommerceMetaRating {
  overall?: number | null;
  productQuality?: number | null;
  logisticsSpeed?: number | null;
  service?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateV1CommerceMetaDelivery {
  shipFrom?: string | null;
  shipTimeText?: string | null;
  deliveryTimeText?: string | null;
  deliveryDays?: number | null;
  freeShipping?: boolean | null;
  returnShippingInsurance?: boolean | null;
  sevenDayNoReasonReturn?: boolean | null;
  serviceLabels?: Array<string> | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateV1CommerceMetaSku {
  availableSizes?: Array<string> | null;
  colorOptions?: Array<string> | null;
  hasSkuMatrix?: boolean | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateV1CommerceMetaPaymentSupportedMethodsItem {
  code: string | null;
  label: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateV1CommerceMetaPayment {
  checkoutMode?: string | null;
  productUrl?: string | null;
  supportedMethods?: Array<ShoppingCandidateV1CommerceMetaPaymentSupportedMethodsItem> | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateV1CommerceMeta {
  rating?: ShoppingCandidateV1CommerceMetaRating | null;
  delivery?: ShoppingCandidateV1CommerceMetaDelivery | null;
  sku?: ShoppingCandidateV1CommerceMetaSku | null;
  payment?: ShoppingCandidateV1CommerceMetaPayment | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateV1SortSignals {
  backendRank?: number | null;
  priceAmount?: number | null;
  relevanceScore?: number | null;
  displayScore?: number | null;
  visualMatchConfidence?: number | null;
  annScore?: number | null;
  ratingScore?: number | null;
  deliveryDays?: number | null;
  stockRank?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateV1DecisionSupport {
  priceConclusion?: string | null;
  stockConclusion?: string | null;
  shopConclusion?: string | null;
  ratingConclusion?: string | null;
  deliveryConclusion?: string | null;
  sizeConclusion?: string | null;
  paymentConclusion?: string | null;
  priorityReason?: string | null;
  priceRank?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateV1Shop {
  shopName?: string | null;
  shopType?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateV1DeliveryEtaReference {
  shipFrom?: string | null;
  shipTimeText?: string | null;
  deliveryTimeText?: string | null;
  deliveryDays?: number | null;
  freeShipping?: boolean | null;
  returnShippingInsurance?: boolean | null;
  sevenDayNoReasonReturn?: boolean | null;
  serviceLabels?: Array<string> | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateV1 {
  candidateItemId: string | null;
  snapshotId?: string | null;
  productId?: string | null;
  productPoolKey?: string | null;
  externalId?: string | null;
  title?: string | null;
  platformName?: string | null;
  currency?: string | null;
  shopName?: string | null;
  shopType?: string | null;
  stockStatus?: string | null;
  coverImageUrl?: string | null;
  productUrl?: string | null;
  platformProductId?: string | null;
  platformBrandId?: string | null;
  createdAt?: string | null;
  rank?: number | null;
  pageIndex?: number | null;
  amount?: string | number | null;
  price?: ShoppingCandidateV1Price | null;
  matchSummary?: Object | null;
  normalizedAttributes?: Object | null;
  rawPayload?: Object | null;
  attributes?: Object | null;
  matchScore?: number | null;
  recommendationReason?: Array<string> | null;
  commerceMeta?: ShoppingCandidateV1CommerceMeta | null;
  sortSignals?: ShoppingCandidateV1SortSignals | null;
  decisionTags?: Array<Object> | null;
  decisionSupport?: ShoppingCandidateV1DecisionSupport | null;
  shop?: ShoppingCandidateV1Shop | null;
  priceHistoryReference?: Object | null;
  deliveryEtaReference?: ShoppingCandidateV1DeliveryEtaReference | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1AppliedFilterPreferences {
  freeShipping?: boolean | null;
  shopTypes?: Array<string> | null;
  brands?: Array<string> | null;
  colors?: Array<string> | null;
  platforms?: Array<string> | null;
  priceDirection?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1AppliedFilter {
  priceMin?: string | number | null;
  priceMax?: string | number | null;
  priceTarget?: string | number | null;
  priceTolerance?: string | number | null;
  timeConstraintDays?: number | null;
  sizeMin?: number | null;
  sizeMax?: number | null;
  stockOnly?: boolean | null;
  freeShippingOnly?: boolean | null;
  urgentDeliveryPreferred?: boolean | null;
  sizeSystem?: string | null;
  shopType?: string | null;
  categoryScope?: string | null;
  platformsInclude?: Array<string> | null;
  platformsExclude?: Array<string> | null;
  brandsInclude?: Array<string> | null;
  brandsExclude?: Array<string> | null;
  colorsInclude?: Array<string> | null;
  colorsExclude?: Array<string> | null;
  sizesInclude?: Array<string> | null;
  excludedProductIds?: Array<string> | null;
  excludedCandidateItemIds?: Array<string> | null;
  sortRule?: string | null;
  preferences?: ShoppingCandidateSetV1AppliedFilterPreferences | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1ItemsItemPrice {
  amount?: string | number | null;
  currency?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1ItemsItemCommerceMetaRating {
  overall?: number | null;
  productQuality?: number | null;
  logisticsSpeed?: number | null;
  service?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1ItemsItemCommerceMetaDelivery {
  shipFrom?: string | null;
  shipTimeText?: string | null;
  deliveryTimeText?: string | null;
  deliveryDays?: number | null;
  freeShipping?: boolean | null;
  returnShippingInsurance?: boolean | null;
  sevenDayNoReasonReturn?: boolean | null;
  serviceLabels?: Array<string> | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1ItemsItemCommerceMetaSku {
  availableSizes?: Array<string> | null;
  colorOptions?: Array<string> | null;
  hasSkuMatrix?: boolean | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1ItemsItemCommerceMetaPaymentSupportedMethodsItem {
  code: string | null;
  label: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1ItemsItemCommerceMetaPayment {
  checkoutMode?: string | null;
  productUrl?: string | null;
  supportedMethods?: Array<ShoppingCandidateSetV1ItemsItemCommerceMetaPaymentSupportedMethodsItem> | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1ItemsItemCommerceMeta {
  rating?: ShoppingCandidateSetV1ItemsItemCommerceMetaRating | null;
  delivery?: ShoppingCandidateSetV1ItemsItemCommerceMetaDelivery | null;
  sku?: ShoppingCandidateSetV1ItemsItemCommerceMetaSku | null;
  payment?: ShoppingCandidateSetV1ItemsItemCommerceMetaPayment | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1ItemsItemSortSignals {
  backendRank?: number | null;
  priceAmount?: number | null;
  relevanceScore?: number | null;
  displayScore?: number | null;
  visualMatchConfidence?: number | null;
  annScore?: number | null;
  ratingScore?: number | null;
  deliveryDays?: number | null;
  stockRank?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1ItemsItemDecisionSupport {
  priceConclusion?: string | null;
  stockConclusion?: string | null;
  shopConclusion?: string | null;
  ratingConclusion?: string | null;
  deliveryConclusion?: string | null;
  sizeConclusion?: string | null;
  paymentConclusion?: string | null;
  priorityReason?: string | null;
  priceRank?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1ItemsItemShop {
  shopName?: string | null;
  shopType?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1ItemsItemDeliveryEtaReference {
  shipFrom?: string | null;
  shipTimeText?: string | null;
  deliveryTimeText?: string | null;
  deliveryDays?: number | null;
  freeShipping?: boolean | null;
  returnShippingInsurance?: boolean | null;
  sevenDayNoReasonReturn?: boolean | null;
  serviceLabels?: Array<string> | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1ItemsItem {
  candidateItemId: string | null;
  snapshotId?: string | null;
  productId?: string | null;
  productPoolKey?: string | null;
  externalId?: string | null;
  title?: string | null;
  platformName?: string | null;
  currency?: string | null;
  shopName?: string | null;
  shopType?: string | null;
  stockStatus?: string | null;
  coverImageUrl?: string | null;
  productUrl?: string | null;
  platformProductId?: string | null;
  platformBrandId?: string | null;
  createdAt?: string | null;
  rank?: number | null;
  pageIndex?: number | null;
  amount?: string | number | null;
  price?: ShoppingCandidateSetV1ItemsItemPrice | null;
  matchSummary?: Object | null;
  normalizedAttributes?: Object | null;
  rawPayload?: Object | null;
  attributes?: Object | null;
  matchScore?: number | null;
  recommendationReason?: Array<string> | null;
  commerceMeta?: ShoppingCandidateSetV1ItemsItemCommerceMeta | null;
  sortSignals?: ShoppingCandidateSetV1ItemsItemSortSignals | null;
  decisionTags?: Array<Object> | null;
  decisionSupport?: ShoppingCandidateSetV1ItemsItemDecisionSupport | null;
  shop?: ShoppingCandidateSetV1ItemsItemShop | null;
  priceHistoryReference?: Object | null;
  deliveryEtaReference?: ShoppingCandidateSetV1ItemsItemDeliveryEtaReference | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1PageRefsItem {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingCandidateSetV1 {
  snapshotId?: string | null;
  candidateSnapshotId?: string | null;
  sessionId?: string | null;
  createdAt?: string | null;
  indexVersion?: string | null;
  recallMethod?: string | null;
  turnIndex?: number | null;
  limit?: number | null;
  totalCount?: number | null;
  degraded?: boolean | null;
  appliedFilter?: ShoppingCandidateSetV1AppliedFilter | null;
  items?: Array<ShoppingCandidateSetV1ItemsItem> | null;
  pageRefs?: Array<ShoppingCandidateSetV1PageRefsItem> | null;
  excludedKeys?: Array<string> | null;
  requiredInfo?: Object | null;
  sortOptions?: Object | null;
  searchProgress?: Object | null;
  fallback?: Object | null;
  cursor?: Object | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingPriceStockV1ItemsItem {
  productId?: string | null;
  candidateItemId?: string | null;
  currency?: string | null;
  stockStatus?: string | null;
  source?: string | null;
  sourceObservedAt?: string | null;
  catalogUpdatedAt?: string | null;
  fetchedAt?: string | null;
  freshness?: string | null;
  status?: string | null;
  reason?: string | null;
  amount?: string | number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingPriceStockV1 {
  items: Array<ShoppingPriceStockV1ItemsItem> | null;
  source?: string | null;
  sourceObservedAt?: string | null;
  catalogUpdatedAt?: string | null;
  fetchedAt?: string | null;
  freshness?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingFiltersV1Preferences {
  freeShipping?: boolean | null;
  shopTypes?: Array<string> | null;
  brands?: Array<string> | null;
  colors?: Array<string> | null;
  platforms?: Array<string> | null;
  priceDirection?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingFiltersV1FilterPatchPreferences {
  freeShipping?: boolean | null;
  shopTypes?: Array<string> | null;
  brands?: Array<string> | null;
  colors?: Array<string> | null;
  platforms?: Array<string> | null;
  priceDirection?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingFiltersV1FilterPatch {
  priceMin?: string | number | null;
  priceMax?: string | number | null;
  priceTarget?: string | number | null;
  priceTolerance?: string | number | null;
  timeConstraintDays?: number | null;
  sizeMin?: number | null;
  sizeMax?: number | null;
  stockOnly?: boolean | null;
  freeShippingOnly?: boolean | null;
  urgentDeliveryPreferred?: boolean | null;
  sizeSystem?: string | null;
  shopType?: string | null;
  categoryScope?: string | null;
  platformsInclude?: Array<string> | null;
  platformsExclude?: Array<string> | null;
  brandsInclude?: Array<string> | null;
  brandsExclude?: Array<string> | null;
  colorsInclude?: Array<string> | null;
  colorsExclude?: Array<string> | null;
  sizesInclude?: Array<string> | null;
  excludedProductIds?: Array<string> | null;
  excludedCandidateItemIds?: Array<string> | null;
  sortRule?: string | null;
  preferences?: ShoppingFiltersV1FilterPatchPreferences | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingFiltersV1OperationsItem {
  kind?: string | null;
  field?: string | null;
  value?: string | null;
  span?: string | null;
  polarity?: string | null;
  source?: string | null;
  values?: Array<string> | null;
  confidence?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingFiltersV1 {
  priceMin?: string | number | null;
  priceMax?: string | number | null;
  priceTarget?: string | number | null;
  priceTolerance?: string | number | null;
  timeConstraintDays?: number | null;
  sizeMin?: number | null;
  sizeMax?: number | null;
  stockOnly?: boolean | null;
  freeShippingOnly?: boolean | null;
  urgentDeliveryPreferred?: boolean | null;
  sizeSystem?: string | null;
  shopType?: string | null;
  categoryScope?: string | null;
  platformsInclude?: Array<string> | null;
  platformsExclude?: Array<string> | null;
  brandsInclude?: Array<string> | null;
  brandsExclude?: Array<string> | null;
  colorsInclude?: Array<string> | null;
  colorsExclude?: Array<string> | null;
  sizesInclude?: Array<string> | null;
  excludedProductIds?: Array<string> | null;
  excludedCandidateItemIds?: Array<string> | null;
  sortRule?: string | null;
  preferences?: ShoppingFiltersV1Preferences | null;
  filterPatch?: ShoppingFiltersV1FilterPatch | null;
  filterRemove?: Array<string> | null;
  shouldResetPreviousFilters?: boolean | null;
  operations?: Array<ShoppingFiltersV1OperationsItem> | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingSessionV1ProfileRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingSessionV1FilterRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingSessionV1CandidateRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingSessionV1PreprocessRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingSessionV1CursorRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingSessionV1ConversationRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingSessionV1 {
  sessionId: string | null;
  owner?: string | null;
  userId?: string | null;
  assetId?: string | null;
  status?: string | null;
  stage?: string | null;
  entrySource?: string | null;
  categoryHint?: string | null;
  startedAt?: string | null;
  lastActiveAt?: string | null;
  currentTurnIndex?: number | null;
  stateVersion?: number | null;
  requestRevision?: number | null;
  degraded?: boolean | null;
  profileRef?: ShoppingSessionV1ProfileRef | null;
  filterRef?: ShoppingSessionV1FilterRef | null;
  candidateRef?: ShoppingSessionV1CandidateRef | null;
  preprocessRef?: ShoppingSessionV1PreprocessRef | null;
  cursorRef?: ShoppingSessionV1CursorRef | null;
  conversationRef?: ShoppingSessionV1ConversationRef | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingPaginationV1 {
  cursorId: string | null;
  sessionId: string | null;
  candidateSnapshotId?: string | null;
  preprocessSnapshotId?: string | null;
  filterHash: string | null;
  sortRule?: string | null;
  expiresAt?: string | null;
  indexVersion?: string | null;
  queryHash?: string | null;
  offset?: number | null;
  limit?: number | null;
  exhausted?: boolean | null;
  raw?: Object | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingAnswerV1EvidenceRefsItem {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingAnswerV1ProfilePatch {
  category: string | null;
  brand?: string | null;
  modelLine?: string | null;
  colorFamily?: string | null;
  colorway?: string | null;
  shoeType?: string | null;
  size?: string | null;
  color?: string | null;
  modelVersion?: string | null;
  profileVersion?: string | null;
  styleTags?: Array<string> | null;
  sceneTags?: Array<string> | null;
  keywords?: Array<string> | null;
  confidence?: number | null;
  raw?: Object | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingAnswerV1FilterPatchPreferences {
  freeShipping?: boolean | null;
  shopTypes?: Array<string> | null;
  brands?: Array<string> | null;
  colors?: Array<string> | null;
  platforms?: Array<string> | null;
  priceDirection?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingAnswerV1FilterPatch {
  priceMin?: string | number | null;
  priceMax?: string | number | null;
  priceTarget?: string | number | null;
  priceTolerance?: string | number | null;
  timeConstraintDays?: number | null;
  sizeMin?: number | null;
  sizeMax?: number | null;
  stockOnly?: boolean | null;
  freeShippingOnly?: boolean | null;
  urgentDeliveryPreferred?: boolean | null;
  sizeSystem?: string | null;
  shopType?: string | null;
  categoryScope?: string | null;
  platformsInclude?: Array<string> | null;
  platformsExclude?: Array<string> | null;
  brandsInclude?: Array<string> | null;
  brandsExclude?: Array<string> | null;
  colorsInclude?: Array<string> | null;
  colorsExclude?: Array<string> | null;
  sizesInclude?: Array<string> | null;
  excludedProductIds?: Array<string> | null;
  excludedCandidateItemIds?: Array<string> | null;
  sortRule?: string | null;
  preferences?: ShoppingAnswerV1FilterPatchPreferences | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingAnswerV1 {
  assistantMessage?: string | null;
  intent?: string | null;
  clarification?: string | null;
  source?: string | null;
  conversationSummary?: string | null;
  evidenceRefs?: Array<ShoppingAnswerV1EvidenceRefsItem> | null;
  candidateComparisons?: Array<Object> | null;
  rejectedOperations?: Array<Object> | null;
  filterRemove?: Array<Object> | null;
  operations?: Array<Object> | null;
  profilePatch?: ShoppingAnswerV1ProfilePatch | null;
  filterPatch?: ShoppingAnswerV1FilterPatch | null;
  shouldResetPreviousFilters?: boolean | null;
  degraded?: boolean | null;
  turnIndex?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingUserContextV1ProfileBlocksItem {
  scope?: string | null;
  schema?: string | null;
  status?: string | null;
  source?: string | null;
  sensitivity?: string | null;
  confidence?: number | null;
  value?: Object | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingUserContextV1MemoryProposalsItem {
  proposalId?: string | null;
  status?: string | null;
  confirmed?: boolean | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingUserContextV1CartRefsItem {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingUserContextV1ShortlistRefsItem {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingUserContextV1FavoriteRefsItem {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingUserContextV1HistoryRefsItem {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingUserContextV1FeedbackRefsItem {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingUserContextV1 {
  profileBlocks?: Array<ShoppingUserContextV1ProfileBlocksItem> | null;
  memoryProposals?: Array<ShoppingUserContextV1MemoryProposalsItem> | null;
  authorizedScopes?: Array<string> | null;
  cartRefs?: Array<ShoppingUserContextV1CartRefsItem> | null;
  shortlistRefs?: Array<ShoppingUserContextV1ShortlistRefsItem> | null;
  favoriteRefs?: Array<ShoppingUserContextV1FavoriteRefsItem> | null;
  historyRefs?: Array<ShoppingUserContextV1HistoryRefsItem> | null;
  feedbackRefs?: Array<ShoppingUserContextV1FeedbackRefsItem> | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1SessionProfileRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1SessionFilterRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1SessionCandidateRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1SessionPreprocessRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1SessionCursorRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1SessionConversationRef {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1Session {
  sessionId: string | null;
  owner?: string | null;
  userId?: string | null;
  assetId?: string | null;
  status?: string | null;
  stage?: string | null;
  entrySource?: string | null;
  categoryHint?: string | null;
  startedAt?: string | null;
  lastActiveAt?: string | null;
  currentTurnIndex?: number | null;
  stateVersion?: number | null;
  requestRevision?: number | null;
  degraded?: boolean | null;
  profileRef?: ShoppingResultV1SessionProfileRef | null;
  filterRef?: ShoppingResultV1SessionFilterRef | null;
  candidateRef?: ShoppingResultV1SessionCandidateRef | null;
  preprocessRef?: ShoppingResultV1SessionPreprocessRef | null;
  cursorRef?: ShoppingResultV1SessionCursorRef | null;
  conversationRef?: ShoppingResultV1SessionConversationRef | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesAppliedFilterPreferences {
  freeShipping?: boolean | null;
  shopTypes?: Array<string> | null;
  brands?: Array<string> | null;
  colors?: Array<string> | null;
  platforms?: Array<string> | null;
  priceDirection?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesAppliedFilter {
  priceMin?: string | number | null;
  priceMax?: string | number | null;
  priceTarget?: string | number | null;
  priceTolerance?: string | number | null;
  timeConstraintDays?: number | null;
  sizeMin?: number | null;
  sizeMax?: number | null;
  stockOnly?: boolean | null;
  freeShippingOnly?: boolean | null;
  urgentDeliveryPreferred?: boolean | null;
  sizeSystem?: string | null;
  shopType?: string | null;
  categoryScope?: string | null;
  platformsInclude?: Array<string> | null;
  platformsExclude?: Array<string> | null;
  brandsInclude?: Array<string> | null;
  brandsExclude?: Array<string> | null;
  colorsInclude?: Array<string> | null;
  colorsExclude?: Array<string> | null;
  sizesInclude?: Array<string> | null;
  excludedProductIds?: Array<string> | null;
  excludedCandidateItemIds?: Array<string> | null;
  sortRule?: string | null;
  preferences?: ShoppingResultV1CandidatesAppliedFilterPreferences | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesItemsItemPrice {
  amount?: string | number | null;
  currency?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesItemsItemCommerceMetaRating {
  overall?: number | null;
  productQuality?: number | null;
  logisticsSpeed?: number | null;
  service?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesItemsItemCommerceMetaDelivery {
  shipFrom?: string | null;
  shipTimeText?: string | null;
  deliveryTimeText?: string | null;
  deliveryDays?: number | null;
  freeShipping?: boolean | null;
  returnShippingInsurance?: boolean | null;
  sevenDayNoReasonReturn?: boolean | null;
  serviceLabels?: Array<string> | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesItemsItemCommerceMetaSku {
  availableSizes?: Array<string> | null;
  colorOptions?: Array<string> | null;
  hasSkuMatrix?: boolean | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesItemsItemCommerceMetaPaymentSupportedMethodsItem {
  code: string | null;
  label: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesItemsItemCommerceMetaPayment {
  checkoutMode?: string | null;
  productUrl?: string | null;
  supportedMethods?: Array<ShoppingResultV1CandidatesItemsItemCommerceMetaPaymentSupportedMethodsItem> | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesItemsItemCommerceMeta {
  rating?: ShoppingResultV1CandidatesItemsItemCommerceMetaRating | null;
  delivery?: ShoppingResultV1CandidatesItemsItemCommerceMetaDelivery | null;
  sku?: ShoppingResultV1CandidatesItemsItemCommerceMetaSku | null;
  payment?: ShoppingResultV1CandidatesItemsItemCommerceMetaPayment | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesItemsItemSortSignals {
  backendRank?: number | null;
  priceAmount?: number | null;
  relevanceScore?: number | null;
  displayScore?: number | null;
  visualMatchConfidence?: number | null;
  annScore?: number | null;
  ratingScore?: number | null;
  deliveryDays?: number | null;
  stockRank?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesItemsItemDecisionSupport {
  priceConclusion?: string | null;
  stockConclusion?: string | null;
  shopConclusion?: string | null;
  ratingConclusion?: string | null;
  deliveryConclusion?: string | null;
  sizeConclusion?: string | null;
  paymentConclusion?: string | null;
  priorityReason?: string | null;
  priceRank?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesItemsItemShop {
  shopName?: string | null;
  shopType?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesItemsItemDeliveryEtaReference {
  shipFrom?: string | null;
  shipTimeText?: string | null;
  deliveryTimeText?: string | null;
  deliveryDays?: number | null;
  freeShipping?: boolean | null;
  returnShippingInsurance?: boolean | null;
  sevenDayNoReasonReturn?: boolean | null;
  serviceLabels?: Array<string> | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesItemsItem {
  candidateItemId: string | null;
  snapshotId?: string | null;
  productId?: string | null;
  productPoolKey?: string | null;
  externalId?: string | null;
  title?: string | null;
  platformName?: string | null;
  currency?: string | null;
  shopName?: string | null;
  shopType?: string | null;
  stockStatus?: string | null;
  coverImageUrl?: string | null;
  productUrl?: string | null;
  platformProductId?: string | null;
  platformBrandId?: string | null;
  createdAt?: string | null;
  rank?: number | null;
  pageIndex?: number | null;
  amount?: string | number | null;
  price?: ShoppingResultV1CandidatesItemsItemPrice | null;
  matchSummary?: Object | null;
  normalizedAttributes?: Object | null;
  rawPayload?: Object | null;
  attributes?: Object | null;
  matchScore?: number | null;
  recommendationReason?: Array<string> | null;
  commerceMeta?: ShoppingResultV1CandidatesItemsItemCommerceMeta | null;
  sortSignals?: ShoppingResultV1CandidatesItemsItemSortSignals | null;
  decisionTags?: Array<Object> | null;
  decisionSupport?: ShoppingResultV1CandidatesItemsItemDecisionSupport | null;
  shop?: ShoppingResultV1CandidatesItemsItemShop | null;
  priceHistoryReference?: Object | null;
  deliveryEtaReference?: ShoppingResultV1CandidatesItemsItemDeliveryEtaReference | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1CandidatesPageRefsItem {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1Candidates {
  snapshotId?: string | null;
  candidateSnapshotId?: string | null;
  sessionId?: string | null;
  createdAt?: string | null;
  indexVersion?: string | null;
  recallMethod?: string | null;
  turnIndex?: number | null;
  limit?: number | null;
  totalCount?: number | null;
  degraded?: boolean | null;
  appliedFilter?: ShoppingResultV1CandidatesAppliedFilter | null;
  items?: Array<ShoppingResultV1CandidatesItemsItem> | null;
  pageRefs?: Array<ShoppingResultV1CandidatesPageRefsItem> | null;
  excludedKeys?: Array<string> | null;
  requiredInfo?: Object | null;
  sortOptions?: Object | null;
  searchProgress?: Object | null;
  fallback?: Object | null;
  cursor?: Object | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1Profile {
  category: string | null;
  brand?: string | null;
  modelLine?: string | null;
  colorFamily?: string | null;
  colorway?: string | null;
  shoeType?: string | null;
  size?: string | null;
  color?: string | null;
  modelVersion?: string | null;
  profileVersion?: string | null;
  styleTags?: Array<string> | null;
  sceneTags?: Array<string> | null;
  keywords?: Array<string> | null;
  confidence?: number | null;
  raw?: Object | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1FiltersPreferences {
  freeShipping?: boolean | null;
  shopTypes?: Array<string> | null;
  brands?: Array<string> | null;
  colors?: Array<string> | null;
  platforms?: Array<string> | null;
  priceDirection?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1Filters {
  priceMin?: string | number | null;
  priceMax?: string | number | null;
  priceTarget?: string | number | null;
  priceTolerance?: string | number | null;
  timeConstraintDays?: number | null;
  sizeMin?: number | null;
  sizeMax?: number | null;
  stockOnly?: boolean | null;
  freeShippingOnly?: boolean | null;
  urgentDeliveryPreferred?: boolean | null;
  sizeSystem?: string | null;
  shopType?: string | null;
  categoryScope?: string | null;
  platformsInclude?: Array<string> | null;
  platformsExclude?: Array<string> | null;
  brandsInclude?: Array<string> | null;
  brandsExclude?: Array<string> | null;
  colorsInclude?: Array<string> | null;
  colorsExclude?: Array<string> | null;
  sizesInclude?: Array<string> | null;
  excludedProductIds?: Array<string> | null;
  excludedCandidateItemIds?: Array<string> | null;
  sortRule?: string | null;
  preferences?: ShoppingResultV1FiltersPreferences | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1AnswerEvidenceRefsItem {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1AnswerProfilePatch {
  category: string | null;
  brand?: string | null;
  modelLine?: string | null;
  colorFamily?: string | null;
  colorway?: string | null;
  shoeType?: string | null;
  size?: string | null;
  color?: string | null;
  modelVersion?: string | null;
  profileVersion?: string | null;
  styleTags?: Array<string> | null;
  sceneTags?: Array<string> | null;
  keywords?: Array<string> | null;
  confidence?: number | null;
  raw?: Object | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1AnswerFilterPatchPreferences {
  freeShipping?: boolean | null;
  shopTypes?: Array<string> | null;
  brands?: Array<string> | null;
  colors?: Array<string> | null;
  platforms?: Array<string> | null;
  priceDirection?: string | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1AnswerFilterPatch {
  priceMin?: string | number | null;
  priceMax?: string | number | null;
  priceTarget?: string | number | null;
  priceTolerance?: string | number | null;
  timeConstraintDays?: number | null;
  sizeMin?: number | null;
  sizeMax?: number | null;
  stockOnly?: boolean | null;
  freeShippingOnly?: boolean | null;
  urgentDeliveryPreferred?: boolean | null;
  sizeSystem?: string | null;
  shopType?: string | null;
  categoryScope?: string | null;
  platformsInclude?: Array<string> | null;
  platformsExclude?: Array<string> | null;
  brandsInclude?: Array<string> | null;
  brandsExclude?: Array<string> | null;
  colorsInclude?: Array<string> | null;
  colorsExclude?: Array<string> | null;
  sizesInclude?: Array<string> | null;
  excludedProductIds?: Array<string> | null;
  excludedCandidateItemIds?: Array<string> | null;
  sortRule?: string | null;
  preferences?: ShoppingResultV1AnswerFilterPatchPreferences | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1Answer {
  assistantMessage?: string | null;
  intent?: string | null;
  clarification?: string | null;
  source?: string | null;
  conversationSummary?: string | null;
  evidenceRefs?: Array<ShoppingResultV1AnswerEvidenceRefsItem> | null;
  candidateComparisons?: Array<Object> | null;
  rejectedOperations?: Array<Object> | null;
  filterRemove?: Array<Object> | null;
  operations?: Array<Object> | null;
  profilePatch?: ShoppingResultV1AnswerProfilePatch | null;
  filterPatch?: ShoppingResultV1AnswerFilterPatch | null;
  shouldResetPreviousFilters?: boolean | null;
  degraded?: boolean | null;
  turnIndex?: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1PricesItem {
  productId?: string | null;
  candidateItemId?: string | null;
  currency?: string | null;
  stockStatus?: string | null;
  source?: string | null;
  sourceObservedAt?: string | null;
  catalogUpdatedAt?: string | null;
  fetchedAt?: string | null;
  freshness?: string | null;
  status?: string | null;
  reason?: string | null;
  amount?: string | number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1EvidenceRefsItem {
  artifactId: string | null;
  contentHash: string | null;
  schemaId: string | null;
  contentVersion: number | null;
  schemaVersion: number | null;
  __extensionsV1?: Record<string, Object>;
}

export interface ShoppingResultV1 {
  traceId?: string | null;
  workflowId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  runtimeRunId?: string | null;
  attemptId?: string | null;
  status: string | null;
  resultRef?: string | null;
  operation?: string | null;
  sessionId?: string | null;
  stateVersion?: number | null;
  requestRevision?: number | null;
  session?: ShoppingResultV1Session | null;
  candidates?: ShoppingResultV1Candidates | null;
  profile?: ShoppingResultV1Profile | null;
  filters?: ShoppingResultV1Filters | null;
  answer?: ShoppingResultV1Answer | null;
  assistantMessage?: string | Object | null;
  prices?: Array<ShoppingResultV1PricesItem> | null;
  priceSource?: string | null;
  pagination?: ShoppingPaginationV1 | null;
  fallback?: Object | null;
  degraded?: boolean | null;
  errors?: Array<Object> | null;
  timing?: Object | null;
  serverTiming?: Object | null;
  evidenceRefs?: Array<ShoppingResultV1EvidenceRefsItem> | null;
  imageSearch?: Object | null;
  __extensionsV1?: Record<string, Object>;
}
export function validShoppingQueryV1FiltersPreferences(value: ShoppingQueryV1FiltersPreferences): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.shopTypes === undefined || value.shopTypes === null || (Array.isArray(value.shopTypes) && value.shopTypes.every((item: string) => item === null || (typeof item === 'string')))) && (value.brands === undefined || value.brands === null || (Array.isArray(value.brands) && value.brands.every((item: string) => item === null || (typeof item === 'string')))) && (value.colors === undefined || value.colors === null || (Array.isArray(value.colors) && value.colors.every((item: string) => item === null || (typeof item === 'string')))) && (value.platforms === undefined || value.platforms === null || (Array.isArray(value.platforms) && value.platforms.every((item: string) => item === null || (typeof item === 'string')))) && (value.priceDirection === undefined || value.priceDirection === null || (typeof value.priceDirection === 'string')); }

export function validShoppingQueryV1Filters(value: ShoppingQueryV1Filters): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.priceMin === undefined || value.priceMin === null || ((typeof value.priceMin === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMin)) || (typeof value.priceMin === 'number' && Number.isFinite(value.priceMin) && value.priceMin >= 0))) && (value.priceMax === undefined || value.priceMax === null || ((typeof value.priceMax === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMax)) || (typeof value.priceMax === 'number' && Number.isFinite(value.priceMax) && value.priceMax >= 0))) && (value.priceTarget === undefined || value.priceTarget === null || ((typeof value.priceTarget === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTarget)) || (typeof value.priceTarget === 'number' && Number.isFinite(value.priceTarget) && value.priceTarget >= 0))) && (value.priceTolerance === undefined || value.priceTolerance === null || ((typeof value.priceTolerance === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTolerance)) || (typeof value.priceTolerance === 'number' && Number.isFinite(value.priceTolerance) && value.priceTolerance >= 0))) && (value.timeConstraintDays === undefined || value.timeConstraintDays === null || (typeof value.timeConstraintDays === 'number' && Number.isFinite(value.timeConstraintDays))) && (value.sizeMin === undefined || value.sizeMin === null || (typeof value.sizeMin === 'number' && Number.isFinite(value.sizeMin))) && (value.sizeMax === undefined || value.sizeMax === null || (typeof value.sizeMax === 'number' && Number.isFinite(value.sizeMax))) && (value.stockOnly === undefined || value.stockOnly === null || (typeof value.stockOnly === 'boolean')) && (value.freeShippingOnly === undefined || value.freeShippingOnly === null || (typeof value.freeShippingOnly === 'boolean')) && (value.urgentDeliveryPreferred === undefined || value.urgentDeliveryPreferred === null || (typeof value.urgentDeliveryPreferred === 'boolean')) && (value.sizeSystem === undefined || value.sizeSystem === null || (typeof value.sizeSystem === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')) && (value.categoryScope === undefined || value.categoryScope === null || (typeof value.categoryScope === 'string')) && (value.platformsInclude === undefined || value.platformsInclude === null || (Array.isArray(value.platformsInclude) && value.platformsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.platformsExclude === undefined || value.platformsExclude === null || (Array.isArray(value.platformsExclude) && value.platformsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsInclude === undefined || value.brandsInclude === null || (Array.isArray(value.brandsInclude) && value.brandsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsExclude === undefined || value.brandsExclude === null || (Array.isArray(value.brandsExclude) && value.brandsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsInclude === undefined || value.colorsInclude === null || (Array.isArray(value.colorsInclude) && value.colorsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsExclude === undefined || value.colorsExclude === null || (Array.isArray(value.colorsExclude) && value.colorsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.sizesInclude === undefined || value.sizesInclude === null || (Array.isArray(value.sizesInclude) && value.sizesInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedProductIds === undefined || value.excludedProductIds === null || (Array.isArray(value.excludedProductIds) && value.excludedProductIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedCandidateItemIds === undefined || value.excludedCandidateItemIds === null || (Array.isArray(value.excludedCandidateItemIds) && value.excludedCandidateItemIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.sortRule === undefined || value.sortRule === null || (typeof value.sortRule === 'string' && ["price_asc","price_desc","relevance_desc","rating_desc","delivery_asc"].indexOf(value.sortRule) >= 0)) && (value.preferences === undefined || value.preferences === null || validShoppingQueryV1FiltersPreferences(value.preferences as ShoppingQueryV1FiltersPreferences)); }

export function validShoppingQueryV1ImageArtifact(value: ShoppingQueryV1ImageArtifact): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingQueryV1ImageRef(value: ShoppingQueryV1ImageRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingQueryV1InitialSubjectSelectionBox(value: ShoppingQueryV1InitialSubjectSelectionBox): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.x === null || (typeof value.x === 'number' && Number.isFinite(value.x))) && (value.y === null || (typeof value.y === 'number' && Number.isFinite(value.y))) && (value.width === null || (typeof value.width === 'number' && Number.isFinite(value.width))) && (value.height === null || (typeof value.height === 'number' && Number.isFinite(value.height))) && (value.confidence === undefined || value.confidence === null || (typeof value.confidence === 'number' && Number.isFinite(value.confidence))) && (value.label === undefined || value.label === null || (typeof value.label === 'string')); }

export function validShoppingQueryV1InitialSubjectSelection(value: ShoppingQueryV1InitialSubjectSelection): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.box === undefined || value.box === null || validShoppingQueryV1InitialSubjectSelectionBox(value.box as ShoppingQueryV1InitialSubjectSelectionBox)) && (value.selectionSource === undefined || value.selectionSource === null || (typeof value.selectionSource === 'string')); }

export function validShoppingQueryV1(value: ShoppingQueryV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.operation === null || (typeof value.operation === 'string')) && (value.message === undefined || value.message === null || (typeof value.message === 'string')) && (value.entrySource === undefined || value.entrySource === null || (typeof value.entrySource === 'string')) && (value.categoryHint === undefined || value.categoryHint === null || (typeof value.categoryHint === 'string')) && (value.sessionId === undefined || value.sessionId === null || (typeof value.sessionId === 'string')) && (value.assetId === undefined || value.assetId === null || (typeof value.assetId === 'string')) && (value.selectionSource === undefined || value.selectionSource === null || (typeof value.selectionSource === 'string')) && (value.sortPreference === undefined || value.sortPreference === null || (typeof value.sortPreference === 'string')) && (value.keywords === undefined || value.keywords === null || (Array.isArray(value.keywords) && value.keywords.every((item: string) => item === null || (typeof item === 'string')))) && (value.filters === undefined || value.filters === null || validShoppingQueryV1Filters(value.filters as ShoppingQueryV1Filters)) && (value.imageArtifact === undefined || value.imageArtifact === null || validShoppingQueryV1ImageArtifact(value.imageArtifact as ShoppingQueryV1ImageArtifact)) && (value.imageRef === undefined || value.imageRef === null || validShoppingQueryV1ImageRef(value.imageRef as ShoppingQueryV1ImageRef)) && (value.initialSubjectSelection === undefined || value.initialSubjectSelection === null || validShoppingQueryV1InitialSubjectSelection(value.initialSubjectSelection as ShoppingQueryV1InitialSubjectSelection)) && (value.highQuality === undefined || value.highQuality === null || (typeof value.highQuality === 'boolean')) && (value.baseVersion === undefined || value.baseVersion === null || (typeof value.baseVersion === 'number' && Number.isSafeInteger(value.baseVersion))) && (value.requestRevision === undefined || value.requestRevision === null || (typeof value.requestRevision === 'number' && Number.isSafeInteger(value.requestRevision))) && (value.idempotencyKey === undefined || value.idempotencyKey === null || (typeof value.idempotencyKey === 'string')); }

export function validShoppingImageV1PrivateLocator(value: ShoppingImageV1PrivateLocator): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.bucketGroup === undefined || value.bucketGroup === null || (typeof value.bucketGroup === 'string')) && (value.objectKey === undefined || value.objectKey === null || (typeof value.objectKey === 'string')); }

export function validShoppingImageV1(value: ShoppingImageV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.assetId === null || (typeof value.assetId === 'string')) && (value.owner === undefined || value.owner === null || (typeof value.owner === 'string')) && (value.assetGroupId === undefined || value.assetGroupId === null || (typeof value.assetGroupId === 'string')) && (value.variantType === undefined || value.variantType === null || (typeof value.variantType === 'string')) && (value.sourceType === undefined || value.sourceType === null || (typeof value.sourceType === 'string')) && (value.uploadStatus === undefined || value.uploadStatus === null || (typeof value.uploadStatus === 'string')) && (value.mediaType === undefined || value.mediaType === null || (typeof value.mediaType === 'string')) && (value.contentHash === undefined || value.contentHash === null || (typeof value.contentHash === 'string')) && (value.isPrimaryRecognitionAsset === undefined || value.isPrimaryRecognitionAsset === null || (typeof value.isPrimaryRecognitionAsset === 'boolean')) && (value.width === undefined || value.width === null || (typeof value.width === 'number' && Number.isSafeInteger(value.width))) && (value.height === undefined || value.height === null || (typeof value.height === 'number' && Number.isSafeInteger(value.height))) && (value.orientation === undefined || value.orientation === null || (typeof value.orientation === 'number' && Number.isSafeInteger(value.orientation))) && (value.sizeBytes === undefined || value.sizeBytes === null || (typeof value.sizeBytes === 'number' && Number.isSafeInteger(value.sizeBytes))) && (value.privateLocator === undefined || value.privateLocator === null || validShoppingImageV1PrivateLocator(value.privateLocator as ShoppingImageV1PrivateLocator)); }

export function validShoppingPreprocessV1OriginalRef(value: ShoppingPreprocessV1OriginalRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingPreprocessV1CropRef(value: ShoppingPreprocessV1CropRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingPreprocessV1SelectedBox(value: ShoppingPreprocessV1SelectedBox): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.x === null || (typeof value.x === 'number' && Number.isFinite(value.x))) && (value.y === null || (typeof value.y === 'number' && Number.isFinite(value.y))) && (value.width === null || (typeof value.width === 'number' && Number.isFinite(value.width))) && (value.height === null || (typeof value.height === 'number' && Number.isFinite(value.height))) && (value.confidence === undefined || value.confidence === null || (typeof value.confidence === 'number' && Number.isFinite(value.confidence))) && (value.label === undefined || value.label === null || (typeof value.label === 'string')); }

export function validShoppingPreprocessV1DetectedBoxesItem(value: ShoppingPreprocessV1DetectedBoxesItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.x === null || (typeof value.x === 'number' && Number.isFinite(value.x))) && (value.y === null || (typeof value.y === 'number' && Number.isFinite(value.y))) && (value.width === null || (typeof value.width === 'number' && Number.isFinite(value.width))) && (value.height === null || (typeof value.height === 'number' && Number.isFinite(value.height))) && (value.confidence === undefined || value.confidence === null || (typeof value.confidence === 'number' && Number.isFinite(value.confidence))) && (value.label === undefined || value.label === null || (typeof value.label === 'string')); }

export function validShoppingPreprocessV1(value: ShoppingPreprocessV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.originalRef === undefined || value.originalRef === null || validShoppingPreprocessV1OriginalRef(value.originalRef as ShoppingPreprocessV1OriginalRef)) && (value.cropRef === undefined || value.cropRef === null || validShoppingPreprocessV1CropRef(value.cropRef as ShoppingPreprocessV1CropRef)) && (value.selectedBox === undefined || value.selectedBox === null || validShoppingPreprocessV1SelectedBox(value.selectedBox as ShoppingPreprocessV1SelectedBox)) && (value.detectedBoxes === undefined || value.detectedBoxes === null || (Array.isArray(value.detectedBoxes) && value.detectedBoxes.every((item: ShoppingPreprocessV1DetectedBoxesItem) => item === null || validShoppingPreprocessV1DetectedBoxesItem(item as ShoppingPreprocessV1DetectedBoxesItem)))) && (value.selectionSource === undefined || value.selectionSource === null || (typeof value.selectionSource === 'string')) && (value.status === undefined || value.status === null || (typeof value.status === 'string')) && (value.transformVersion === undefined || value.transformVersion === null || (typeof value.transformVersion === 'string')) && (value.encoding === undefined || value.encoding === null || (typeof value.encoding === 'string')) && (value.imageWidth === undefined || value.imageWidth === null || (typeof value.imageWidth === 'number' && Number.isSafeInteger(value.imageWidth))) && (value.imageHeight === undefined || value.imageHeight === null || (typeof value.imageHeight === 'number' && Number.isSafeInteger(value.imageHeight))) && (value.targetSize === undefined || value.targetSize === null || (typeof value.targetSize === 'number' && Number.isSafeInteger(value.targetSize))) && (value.jpegQuality === undefined || value.jpegQuality === null || (typeof value.jpegQuality === 'number' && Number.isSafeInteger(value.jpegQuality))) && (value.paddingRatio === undefined || value.paddingRatio === null || (typeof value.paddingRatio === 'number' && Number.isFinite(value.paddingRatio))); }

export function validShoppingQualityV1(value: ShoppingQualityV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.method === null || (typeof value.method === 'string')) && (value.reason === undefined || value.reason === null || (typeof value.reason === 'string')) && (value.width === undefined || value.width === null || (typeof value.width === 'number' && Number.isSafeInteger(value.width))) && (value.height === undefined || value.height === null || (typeof value.height === 'number' && Number.isSafeInteger(value.height))) && (value.decodable === undefined || value.decodable === null || (typeof value.decodable === 'boolean')) && (value.passed === null || (typeof value.passed === 'boolean')) && (value.thresholds === undefined || value.thresholds === null || value.thresholds !== undefined) && (value.sharpness === undefined || value.sharpness === null || (typeof value.sharpness === 'number' && Number.isFinite(value.sharpness))) && (value.subjectVisibility === undefined || value.subjectVisibility === null || (typeof value.subjectVisibility === 'number' && Number.isFinite(value.subjectVisibility))); }

export function validShoppingProfileV1(value: ShoppingProfileV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.category === null || (typeof value.category === 'string')) && (value.brand === undefined || value.brand === null || (typeof value.brand === 'string')) && (value.modelLine === undefined || value.modelLine === null || (typeof value.modelLine === 'string')) && (value.colorFamily === undefined || value.colorFamily === null || (typeof value.colorFamily === 'string')) && (value.colorway === undefined || value.colorway === null || (typeof value.colorway === 'string')) && (value.shoeType === undefined || value.shoeType === null || (typeof value.shoeType === 'string')) && (value.size === undefined || value.size === null || (typeof value.size === 'string')) && (value.color === undefined || value.color === null || (typeof value.color === 'string')) && (value.modelVersion === undefined || value.modelVersion === null || (typeof value.modelVersion === 'string')) && (value.profileVersion === undefined || value.profileVersion === null || (typeof value.profileVersion === 'string')) && (value.styleTags === undefined || value.styleTags === null || (Array.isArray(value.styleTags) && value.styleTags.every((item: string) => item === null || (typeof item === 'string')))) && (value.sceneTags === undefined || value.sceneTags === null || (Array.isArray(value.sceneTags) && value.sceneTags.every((item: string) => item === null || (typeof item === 'string')))) && (value.keywords === undefined || value.keywords === null || (Array.isArray(value.keywords) && value.keywords.every((item: string) => item === null || (typeof item === 'string')))) && (value.confidence === undefined || value.confidence === null || (typeof value.confidence === 'number' && Number.isFinite(value.confidence))) && (value.raw === undefined || value.raw === null || value.raw !== undefined); }

export function validShoppingEmbeddingV1VectorRef(value: ShoppingEmbeddingV1VectorRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingEmbeddingV1(value: ShoppingEmbeddingV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.provider === undefined || value.provider === null || (typeof value.provider === 'string')) && (value.modelName === undefined || value.modelName === null || (typeof value.modelName === 'string')) && (value.modelId === undefined || value.modelId === null || (typeof value.modelId === 'string')) && (value.modelVersion === undefined || value.modelVersion === null || (typeof value.modelVersion === 'string')) && (value.modelHash === undefined || value.modelHash === null || (typeof value.modelHash === 'string')) && (value.vectorHash === undefined || value.vectorHash === null || (typeof value.vectorHash === 'string')) && (value.embeddingKind === null || (typeof value.embeddingKind === 'string')) && (value.dtype === undefined || value.dtype === null || (typeof value.dtype === 'string')) && (value.normalization === undefined || value.normalization === null || (typeof value.normalization === 'string')) && (value.preprocessVersion === undefined || value.preprocessVersion === null || (typeof value.preprocessVersion === 'string')) && (value.indexSpaceId === undefined || value.indexSpaceId === null || (typeof value.indexSpaceId === 'string')) && (value.dimension === null || (typeof value.dimension === 'number' && Number.isSafeInteger(value.dimension))) && (value.vectorRef === undefined || value.vectorRef === null || validShoppingEmbeddingV1VectorRef(value.vectorRef as ShoppingEmbeddingV1VectorRef)) && (value.vector === undefined || value.vector === null || (Array.isArray(value.vector) && value.vector.every((item: number) => item === null || (typeof item === 'number' && Number.isFinite(item))))); }

export function validShoppingProductV1(value: ShoppingProductV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.productId === null || (typeof value.productId === 'string')) && (value.externalId === undefined || value.externalId === null || (typeof value.externalId === 'string')) && (value.platform === undefined || value.platform === null || (typeof value.platform === 'string')) && (value.title === null || (typeof value.title === 'string')) && (value.currency === undefined || value.currency === null || (typeof value.currency === 'string')) && (value.stockStatus === undefined || value.stockStatus === null || (typeof value.stockStatus === 'string')) && (value.shopName === undefined || value.shopName === null || (typeof value.shopName === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')) && (value.productUrl === undefined || value.productUrl === null || (typeof value.productUrl === 'string')) && (value.sourceImageUrl === undefined || value.sourceImageUrl === null || (typeof value.sourceImageUrl === 'string')) && (value.imageBucketGroup === undefined || value.imageBucketGroup === null || (typeof value.imageBucketGroup === 'string')) && (value.imageObjectKey === undefined || value.imageObjectKey === null || (typeof value.imageObjectKey === 'string')) && (value.imagePublicUrl === undefined || value.imagePublicUrl === null || (typeof value.imagePublicUrl === 'string')) && (value.tagStatus === undefined || value.tagStatus === null || (typeof value.tagStatus === 'string')) && (value.brand === undefined || value.brand === null || (typeof value.brand === 'string')) && (value.category === undefined || value.category === null || (typeof value.category === 'string')) && (value.modelLine === undefined || value.modelLine === null || (typeof value.modelLine === 'string')) && (value.colorFamily === undefined || value.colorFamily === null || (typeof value.colorFamily === 'string')) && (value.colorway === undefined || value.colorway === null || (typeof value.colorway === 'string')) && (value.shoeType === undefined || value.shoeType === null || (typeof value.shoeType === 'string')) && (value.importBatchId === undefined || value.importBatchId === null || (typeof value.importBatchId === 'string')) && (value.createdAt === undefined || value.createdAt === null || (typeof value.createdAt === 'string')) && (value.updatedAt === undefined || value.updatedAt === null || (typeof value.updatedAt === 'string')) && (value.priceAmount === undefined || value.priceAmount === null || ((typeof value.priceAmount === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceAmount)) || (typeof value.priceAmount === 'number' && Number.isFinite(value.priceAmount) && value.priceAmount >= 0))) && (value.keywords === undefined || value.keywords === null || (Array.isArray(value.keywords) && value.keywords.every((item: string) => item === null || (typeof item === 'string')))) && (value.normalizedTags === undefined || value.normalizedTags === null || value.normalizedTags !== undefined) && (value.rawPayload === undefined || value.rawPayload === null || value.rawPayload !== undefined) && (value.tagConfidence === undefined || value.tagConfidence === null || (typeof value.tagConfidence === 'number' && Number.isFinite(value.tagConfidence))); }

export function validShoppingCandidateV1Price(value: ShoppingCandidateV1Price): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.amount === undefined || value.amount === null || ((typeof value.amount === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.amount)) || (typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount >= 0))) && (value.currency === undefined || value.currency === null || (typeof value.currency === 'string')); }

export function validShoppingCandidateV1CommerceMetaRating(value: ShoppingCandidateV1CommerceMetaRating): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.overall === undefined || value.overall === null || (typeof value.overall === 'number' && Number.isFinite(value.overall))) && (value.productQuality === undefined || value.productQuality === null || (typeof value.productQuality === 'number' && Number.isFinite(value.productQuality))) && (value.logisticsSpeed === undefined || value.logisticsSpeed === null || (typeof value.logisticsSpeed === 'number' && Number.isFinite(value.logisticsSpeed))) && (value.service === undefined || value.service === null || (typeof value.service === 'number' && Number.isFinite(value.service))); }

export function validShoppingCandidateV1CommerceMetaDelivery(value: ShoppingCandidateV1CommerceMetaDelivery): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.shipFrom === undefined || value.shipFrom === null || (typeof value.shipFrom === 'string')) && (value.shipTimeText === undefined || value.shipTimeText === null || (typeof value.shipTimeText === 'string')) && (value.deliveryTimeText === undefined || value.deliveryTimeText === null || (typeof value.deliveryTimeText === 'string')) && (value.deliveryDays === undefined || value.deliveryDays === null || (typeof value.deliveryDays === 'number' && Number.isFinite(value.deliveryDays))) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.returnShippingInsurance === undefined || value.returnShippingInsurance === null || (typeof value.returnShippingInsurance === 'boolean')) && (value.sevenDayNoReasonReturn === undefined || value.sevenDayNoReasonReturn === null || (typeof value.sevenDayNoReasonReturn === 'boolean')) && (value.serviceLabels === undefined || value.serviceLabels === null || (Array.isArray(value.serviceLabels) && value.serviceLabels.every((item: string) => item === null || (typeof item === 'string')))); }

export function validShoppingCandidateV1CommerceMetaSku(value: ShoppingCandidateV1CommerceMetaSku): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.availableSizes === undefined || value.availableSizes === null || (Array.isArray(value.availableSizes) && value.availableSizes.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorOptions === undefined || value.colorOptions === null || (Array.isArray(value.colorOptions) && value.colorOptions.every((item: string) => item === null || (typeof item === 'string')))) && (value.hasSkuMatrix === undefined || value.hasSkuMatrix === null || (typeof value.hasSkuMatrix === 'boolean')); }

export function validShoppingCandidateV1CommerceMetaPaymentSupportedMethodsItem(value: ShoppingCandidateV1CommerceMetaPaymentSupportedMethodsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.code === null || (typeof value.code === 'string')) && (value.label === null || (typeof value.label === 'string')); }

export function validShoppingCandidateV1CommerceMetaPayment(value: ShoppingCandidateV1CommerceMetaPayment): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.checkoutMode === undefined || value.checkoutMode === null || (typeof value.checkoutMode === 'string')) && (value.productUrl === undefined || value.productUrl === null || (typeof value.productUrl === 'string')) && (value.supportedMethods === undefined || value.supportedMethods === null || (Array.isArray(value.supportedMethods) && value.supportedMethods.every((item: ShoppingCandidateV1CommerceMetaPaymentSupportedMethodsItem) => item === null || validShoppingCandidateV1CommerceMetaPaymentSupportedMethodsItem(item as ShoppingCandidateV1CommerceMetaPaymentSupportedMethodsItem)))); }

export function validShoppingCandidateV1CommerceMeta(value: ShoppingCandidateV1CommerceMeta): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.rating === undefined || value.rating === null || validShoppingCandidateV1CommerceMetaRating(value.rating as ShoppingCandidateV1CommerceMetaRating)) && (value.delivery === undefined || value.delivery === null || validShoppingCandidateV1CommerceMetaDelivery(value.delivery as ShoppingCandidateV1CommerceMetaDelivery)) && (value.sku === undefined || value.sku === null || validShoppingCandidateV1CommerceMetaSku(value.sku as ShoppingCandidateV1CommerceMetaSku)) && (value.payment === undefined || value.payment === null || validShoppingCandidateV1CommerceMetaPayment(value.payment as ShoppingCandidateV1CommerceMetaPayment)); }

export function validShoppingCandidateV1SortSignals(value: ShoppingCandidateV1SortSignals): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.backendRank === undefined || value.backendRank === null || (typeof value.backendRank === 'number' && Number.isFinite(value.backendRank))) && (value.priceAmount === undefined || value.priceAmount === null || (typeof value.priceAmount === 'number' && Number.isFinite(value.priceAmount))) && (value.relevanceScore === undefined || value.relevanceScore === null || (typeof value.relevanceScore === 'number' && Number.isFinite(value.relevanceScore))) && (value.displayScore === undefined || value.displayScore === null || (typeof value.displayScore === 'number' && Number.isFinite(value.displayScore))) && (value.visualMatchConfidence === undefined || value.visualMatchConfidence === null || (typeof value.visualMatchConfidence === 'number' && Number.isFinite(value.visualMatchConfidence))) && (value.annScore === undefined || value.annScore === null || (typeof value.annScore === 'number' && Number.isFinite(value.annScore))) && (value.ratingScore === undefined || value.ratingScore === null || (typeof value.ratingScore === 'number' && Number.isFinite(value.ratingScore))) && (value.deliveryDays === undefined || value.deliveryDays === null || (typeof value.deliveryDays === 'number' && Number.isFinite(value.deliveryDays))) && (value.stockRank === undefined || value.stockRank === null || (typeof value.stockRank === 'number' && Number.isFinite(value.stockRank))); }

export function validShoppingCandidateV1DecisionSupport(value: ShoppingCandidateV1DecisionSupport): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.priceConclusion === undefined || value.priceConclusion === null || (typeof value.priceConclusion === 'string')) && (value.stockConclusion === undefined || value.stockConclusion === null || (typeof value.stockConclusion === 'string')) && (value.shopConclusion === undefined || value.shopConclusion === null || (typeof value.shopConclusion === 'string')) && (value.ratingConclusion === undefined || value.ratingConclusion === null || (typeof value.ratingConclusion === 'string')) && (value.deliveryConclusion === undefined || value.deliveryConclusion === null || (typeof value.deliveryConclusion === 'string')) && (value.sizeConclusion === undefined || value.sizeConclusion === null || (typeof value.sizeConclusion === 'string')) && (value.paymentConclusion === undefined || value.paymentConclusion === null || (typeof value.paymentConclusion === 'string')) && (value.priorityReason === undefined || value.priorityReason === null || (typeof value.priorityReason === 'string')) && (value.priceRank === undefined || value.priceRank === null || (typeof value.priceRank === 'number' && Number.isSafeInteger(value.priceRank))); }

export function validShoppingCandidateV1Shop(value: ShoppingCandidateV1Shop): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.shopName === undefined || value.shopName === null || (typeof value.shopName === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')); }

export function validShoppingCandidateV1DeliveryEtaReference(value: ShoppingCandidateV1DeliveryEtaReference): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.shipFrom === undefined || value.shipFrom === null || (typeof value.shipFrom === 'string')) && (value.shipTimeText === undefined || value.shipTimeText === null || (typeof value.shipTimeText === 'string')) && (value.deliveryTimeText === undefined || value.deliveryTimeText === null || (typeof value.deliveryTimeText === 'string')) && (value.deliveryDays === undefined || value.deliveryDays === null || (typeof value.deliveryDays === 'number' && Number.isFinite(value.deliveryDays))) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.returnShippingInsurance === undefined || value.returnShippingInsurance === null || (typeof value.returnShippingInsurance === 'boolean')) && (value.sevenDayNoReasonReturn === undefined || value.sevenDayNoReasonReturn === null || (typeof value.sevenDayNoReasonReturn === 'boolean')) && (value.serviceLabels === undefined || value.serviceLabels === null || (Array.isArray(value.serviceLabels) && value.serviceLabels.every((item: string) => item === null || (typeof item === 'string')))); }

export function validShoppingCandidateV1(value: ShoppingCandidateV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.candidateItemId === null || (typeof value.candidateItemId === 'string')) && (value.snapshotId === undefined || value.snapshotId === null || (typeof value.snapshotId === 'string')) && (value.productId === undefined || value.productId === null || (typeof value.productId === 'string')) && (value.productPoolKey === undefined || value.productPoolKey === null || (typeof value.productPoolKey === 'string')) && (value.externalId === undefined || value.externalId === null || (typeof value.externalId === 'string')) && (value.title === undefined || value.title === null || (typeof value.title === 'string')) && (value.platformName === undefined || value.platformName === null || (typeof value.platformName === 'string')) && (value.currency === undefined || value.currency === null || (typeof value.currency === 'string')) && (value.shopName === undefined || value.shopName === null || (typeof value.shopName === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')) && (value.stockStatus === undefined || value.stockStatus === null || (typeof value.stockStatus === 'string')) && (value.coverImageUrl === undefined || value.coverImageUrl === null || (typeof value.coverImageUrl === 'string')) && (value.productUrl === undefined || value.productUrl === null || (typeof value.productUrl === 'string')) && (value.platformProductId === undefined || value.platformProductId === null || (typeof value.platformProductId === 'string')) && (value.platformBrandId === undefined || value.platformBrandId === null || (typeof value.platformBrandId === 'string')) && (value.createdAt === undefined || value.createdAt === null || (typeof value.createdAt === 'string')) && (value.rank === undefined || value.rank === null || (typeof value.rank === 'number' && Number.isSafeInteger(value.rank))) && (value.pageIndex === undefined || value.pageIndex === null || (typeof value.pageIndex === 'number' && Number.isSafeInteger(value.pageIndex))) && (value.amount === undefined || value.amount === null || ((typeof value.amount === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.amount)) || (typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount >= 0))) && (value.price === undefined || value.price === null || validShoppingCandidateV1Price(value.price as ShoppingCandidateV1Price)) && (value.matchSummary === undefined || value.matchSummary === null || value.matchSummary !== undefined) && (value.normalizedAttributes === undefined || value.normalizedAttributes === null || value.normalizedAttributes !== undefined) && (value.rawPayload === undefined || value.rawPayload === null || value.rawPayload !== undefined) && (value.attributes === undefined || value.attributes === null || value.attributes !== undefined) && (value.matchScore === undefined || value.matchScore === null || (typeof value.matchScore === 'number' && Number.isFinite(value.matchScore))) && (value.recommendationReason === undefined || value.recommendationReason === null || (Array.isArray(value.recommendationReason) && value.recommendationReason.every((item: string) => item === null || (typeof item === 'string')))) && (value.commerceMeta === undefined || value.commerceMeta === null || validShoppingCandidateV1CommerceMeta(value.commerceMeta as ShoppingCandidateV1CommerceMeta)) && (value.sortSignals === undefined || value.sortSignals === null || validShoppingCandidateV1SortSignals(value.sortSignals as ShoppingCandidateV1SortSignals)) && (value.decisionTags === undefined || value.decisionTags === null || (Array.isArray(value.decisionTags) && value.decisionTags.every((item: Object) => item === null || item !== undefined))) && (value.decisionSupport === undefined || value.decisionSupport === null || validShoppingCandidateV1DecisionSupport(value.decisionSupport as ShoppingCandidateV1DecisionSupport)) && (value.shop === undefined || value.shop === null || validShoppingCandidateV1Shop(value.shop as ShoppingCandidateV1Shop)) && (value.priceHistoryReference === undefined || value.priceHistoryReference === null || value.priceHistoryReference !== undefined) && (value.deliveryEtaReference === undefined || value.deliveryEtaReference === null || validShoppingCandidateV1DeliveryEtaReference(value.deliveryEtaReference as ShoppingCandidateV1DeliveryEtaReference)); }

export function validShoppingCandidateSetV1AppliedFilterPreferences(value: ShoppingCandidateSetV1AppliedFilterPreferences): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.shopTypes === undefined || value.shopTypes === null || (Array.isArray(value.shopTypes) && value.shopTypes.every((item: string) => item === null || (typeof item === 'string')))) && (value.brands === undefined || value.brands === null || (Array.isArray(value.brands) && value.brands.every((item: string) => item === null || (typeof item === 'string')))) && (value.colors === undefined || value.colors === null || (Array.isArray(value.colors) && value.colors.every((item: string) => item === null || (typeof item === 'string')))) && (value.platforms === undefined || value.platforms === null || (Array.isArray(value.platforms) && value.platforms.every((item: string) => item === null || (typeof item === 'string')))) && (value.priceDirection === undefined || value.priceDirection === null || (typeof value.priceDirection === 'string')); }

export function validShoppingCandidateSetV1AppliedFilter(value: ShoppingCandidateSetV1AppliedFilter): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.priceMin === undefined || value.priceMin === null || ((typeof value.priceMin === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMin)) || (typeof value.priceMin === 'number' && Number.isFinite(value.priceMin) && value.priceMin >= 0))) && (value.priceMax === undefined || value.priceMax === null || ((typeof value.priceMax === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMax)) || (typeof value.priceMax === 'number' && Number.isFinite(value.priceMax) && value.priceMax >= 0))) && (value.priceTarget === undefined || value.priceTarget === null || ((typeof value.priceTarget === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTarget)) || (typeof value.priceTarget === 'number' && Number.isFinite(value.priceTarget) && value.priceTarget >= 0))) && (value.priceTolerance === undefined || value.priceTolerance === null || ((typeof value.priceTolerance === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTolerance)) || (typeof value.priceTolerance === 'number' && Number.isFinite(value.priceTolerance) && value.priceTolerance >= 0))) && (value.timeConstraintDays === undefined || value.timeConstraintDays === null || (typeof value.timeConstraintDays === 'number' && Number.isFinite(value.timeConstraintDays))) && (value.sizeMin === undefined || value.sizeMin === null || (typeof value.sizeMin === 'number' && Number.isFinite(value.sizeMin))) && (value.sizeMax === undefined || value.sizeMax === null || (typeof value.sizeMax === 'number' && Number.isFinite(value.sizeMax))) && (value.stockOnly === undefined || value.stockOnly === null || (typeof value.stockOnly === 'boolean')) && (value.freeShippingOnly === undefined || value.freeShippingOnly === null || (typeof value.freeShippingOnly === 'boolean')) && (value.urgentDeliveryPreferred === undefined || value.urgentDeliveryPreferred === null || (typeof value.urgentDeliveryPreferred === 'boolean')) && (value.sizeSystem === undefined || value.sizeSystem === null || (typeof value.sizeSystem === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')) && (value.categoryScope === undefined || value.categoryScope === null || (typeof value.categoryScope === 'string')) && (value.platformsInclude === undefined || value.platformsInclude === null || (Array.isArray(value.platformsInclude) && value.platformsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.platformsExclude === undefined || value.platformsExclude === null || (Array.isArray(value.platformsExclude) && value.platformsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsInclude === undefined || value.brandsInclude === null || (Array.isArray(value.brandsInclude) && value.brandsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsExclude === undefined || value.brandsExclude === null || (Array.isArray(value.brandsExclude) && value.brandsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsInclude === undefined || value.colorsInclude === null || (Array.isArray(value.colorsInclude) && value.colorsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsExclude === undefined || value.colorsExclude === null || (Array.isArray(value.colorsExclude) && value.colorsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.sizesInclude === undefined || value.sizesInclude === null || (Array.isArray(value.sizesInclude) && value.sizesInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedProductIds === undefined || value.excludedProductIds === null || (Array.isArray(value.excludedProductIds) && value.excludedProductIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedCandidateItemIds === undefined || value.excludedCandidateItemIds === null || (Array.isArray(value.excludedCandidateItemIds) && value.excludedCandidateItemIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.sortRule === undefined || value.sortRule === null || (typeof value.sortRule === 'string' && ["price_asc","price_desc","relevance_desc","rating_desc","delivery_asc"].indexOf(value.sortRule) >= 0)) && (value.preferences === undefined || value.preferences === null || validShoppingCandidateSetV1AppliedFilterPreferences(value.preferences as ShoppingCandidateSetV1AppliedFilterPreferences)); }

export function validShoppingCandidateSetV1ItemsItemPrice(value: ShoppingCandidateSetV1ItemsItemPrice): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.amount === undefined || value.amount === null || ((typeof value.amount === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.amount)) || (typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount >= 0))) && (value.currency === undefined || value.currency === null || (typeof value.currency === 'string')); }

export function validShoppingCandidateSetV1ItemsItemCommerceMetaRating(value: ShoppingCandidateSetV1ItemsItemCommerceMetaRating): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.overall === undefined || value.overall === null || (typeof value.overall === 'number' && Number.isFinite(value.overall))) && (value.productQuality === undefined || value.productQuality === null || (typeof value.productQuality === 'number' && Number.isFinite(value.productQuality))) && (value.logisticsSpeed === undefined || value.logisticsSpeed === null || (typeof value.logisticsSpeed === 'number' && Number.isFinite(value.logisticsSpeed))) && (value.service === undefined || value.service === null || (typeof value.service === 'number' && Number.isFinite(value.service))); }

export function validShoppingCandidateSetV1ItemsItemCommerceMetaDelivery(value: ShoppingCandidateSetV1ItemsItemCommerceMetaDelivery): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.shipFrom === undefined || value.shipFrom === null || (typeof value.shipFrom === 'string')) && (value.shipTimeText === undefined || value.shipTimeText === null || (typeof value.shipTimeText === 'string')) && (value.deliveryTimeText === undefined || value.deliveryTimeText === null || (typeof value.deliveryTimeText === 'string')) && (value.deliveryDays === undefined || value.deliveryDays === null || (typeof value.deliveryDays === 'number' && Number.isFinite(value.deliveryDays))) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.returnShippingInsurance === undefined || value.returnShippingInsurance === null || (typeof value.returnShippingInsurance === 'boolean')) && (value.sevenDayNoReasonReturn === undefined || value.sevenDayNoReasonReturn === null || (typeof value.sevenDayNoReasonReturn === 'boolean')) && (value.serviceLabels === undefined || value.serviceLabels === null || (Array.isArray(value.serviceLabels) && value.serviceLabels.every((item: string) => item === null || (typeof item === 'string')))); }

export function validShoppingCandidateSetV1ItemsItemCommerceMetaSku(value: ShoppingCandidateSetV1ItemsItemCommerceMetaSku): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.availableSizes === undefined || value.availableSizes === null || (Array.isArray(value.availableSizes) && value.availableSizes.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorOptions === undefined || value.colorOptions === null || (Array.isArray(value.colorOptions) && value.colorOptions.every((item: string) => item === null || (typeof item === 'string')))) && (value.hasSkuMatrix === undefined || value.hasSkuMatrix === null || (typeof value.hasSkuMatrix === 'boolean')); }

export function validShoppingCandidateSetV1ItemsItemCommerceMetaPaymentSupportedMethodsItem(value: ShoppingCandidateSetV1ItemsItemCommerceMetaPaymentSupportedMethodsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.code === null || (typeof value.code === 'string')) && (value.label === null || (typeof value.label === 'string')); }

export function validShoppingCandidateSetV1ItemsItemCommerceMetaPayment(value: ShoppingCandidateSetV1ItemsItemCommerceMetaPayment): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.checkoutMode === undefined || value.checkoutMode === null || (typeof value.checkoutMode === 'string')) && (value.productUrl === undefined || value.productUrl === null || (typeof value.productUrl === 'string')) && (value.supportedMethods === undefined || value.supportedMethods === null || (Array.isArray(value.supportedMethods) && value.supportedMethods.every((item: ShoppingCandidateSetV1ItemsItemCommerceMetaPaymentSupportedMethodsItem) => item === null || validShoppingCandidateSetV1ItemsItemCommerceMetaPaymentSupportedMethodsItem(item as ShoppingCandidateSetV1ItemsItemCommerceMetaPaymentSupportedMethodsItem)))); }

export function validShoppingCandidateSetV1ItemsItemCommerceMeta(value: ShoppingCandidateSetV1ItemsItemCommerceMeta): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.rating === undefined || value.rating === null || validShoppingCandidateSetV1ItemsItemCommerceMetaRating(value.rating as ShoppingCandidateSetV1ItemsItemCommerceMetaRating)) && (value.delivery === undefined || value.delivery === null || validShoppingCandidateSetV1ItemsItemCommerceMetaDelivery(value.delivery as ShoppingCandidateSetV1ItemsItemCommerceMetaDelivery)) && (value.sku === undefined || value.sku === null || validShoppingCandidateSetV1ItemsItemCommerceMetaSku(value.sku as ShoppingCandidateSetV1ItemsItemCommerceMetaSku)) && (value.payment === undefined || value.payment === null || validShoppingCandidateSetV1ItemsItemCommerceMetaPayment(value.payment as ShoppingCandidateSetV1ItemsItemCommerceMetaPayment)); }

export function validShoppingCandidateSetV1ItemsItemSortSignals(value: ShoppingCandidateSetV1ItemsItemSortSignals): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.backendRank === undefined || value.backendRank === null || (typeof value.backendRank === 'number' && Number.isFinite(value.backendRank))) && (value.priceAmount === undefined || value.priceAmount === null || (typeof value.priceAmount === 'number' && Number.isFinite(value.priceAmount))) && (value.relevanceScore === undefined || value.relevanceScore === null || (typeof value.relevanceScore === 'number' && Number.isFinite(value.relevanceScore))) && (value.displayScore === undefined || value.displayScore === null || (typeof value.displayScore === 'number' && Number.isFinite(value.displayScore))) && (value.visualMatchConfidence === undefined || value.visualMatchConfidence === null || (typeof value.visualMatchConfidence === 'number' && Number.isFinite(value.visualMatchConfidence))) && (value.annScore === undefined || value.annScore === null || (typeof value.annScore === 'number' && Number.isFinite(value.annScore))) && (value.ratingScore === undefined || value.ratingScore === null || (typeof value.ratingScore === 'number' && Number.isFinite(value.ratingScore))) && (value.deliveryDays === undefined || value.deliveryDays === null || (typeof value.deliveryDays === 'number' && Number.isFinite(value.deliveryDays))) && (value.stockRank === undefined || value.stockRank === null || (typeof value.stockRank === 'number' && Number.isFinite(value.stockRank))); }

export function validShoppingCandidateSetV1ItemsItemDecisionSupport(value: ShoppingCandidateSetV1ItemsItemDecisionSupport): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.priceConclusion === undefined || value.priceConclusion === null || (typeof value.priceConclusion === 'string')) && (value.stockConclusion === undefined || value.stockConclusion === null || (typeof value.stockConclusion === 'string')) && (value.shopConclusion === undefined || value.shopConclusion === null || (typeof value.shopConclusion === 'string')) && (value.ratingConclusion === undefined || value.ratingConclusion === null || (typeof value.ratingConclusion === 'string')) && (value.deliveryConclusion === undefined || value.deliveryConclusion === null || (typeof value.deliveryConclusion === 'string')) && (value.sizeConclusion === undefined || value.sizeConclusion === null || (typeof value.sizeConclusion === 'string')) && (value.paymentConclusion === undefined || value.paymentConclusion === null || (typeof value.paymentConclusion === 'string')) && (value.priorityReason === undefined || value.priorityReason === null || (typeof value.priorityReason === 'string')) && (value.priceRank === undefined || value.priceRank === null || (typeof value.priceRank === 'number' && Number.isSafeInteger(value.priceRank))); }

export function validShoppingCandidateSetV1ItemsItemShop(value: ShoppingCandidateSetV1ItemsItemShop): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.shopName === undefined || value.shopName === null || (typeof value.shopName === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')); }

export function validShoppingCandidateSetV1ItemsItemDeliveryEtaReference(value: ShoppingCandidateSetV1ItemsItemDeliveryEtaReference): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.shipFrom === undefined || value.shipFrom === null || (typeof value.shipFrom === 'string')) && (value.shipTimeText === undefined || value.shipTimeText === null || (typeof value.shipTimeText === 'string')) && (value.deliveryTimeText === undefined || value.deliveryTimeText === null || (typeof value.deliveryTimeText === 'string')) && (value.deliveryDays === undefined || value.deliveryDays === null || (typeof value.deliveryDays === 'number' && Number.isFinite(value.deliveryDays))) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.returnShippingInsurance === undefined || value.returnShippingInsurance === null || (typeof value.returnShippingInsurance === 'boolean')) && (value.sevenDayNoReasonReturn === undefined || value.sevenDayNoReasonReturn === null || (typeof value.sevenDayNoReasonReturn === 'boolean')) && (value.serviceLabels === undefined || value.serviceLabels === null || (Array.isArray(value.serviceLabels) && value.serviceLabels.every((item: string) => item === null || (typeof item === 'string')))); }

export function validShoppingCandidateSetV1ItemsItem(value: ShoppingCandidateSetV1ItemsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.candidateItemId === null || (typeof value.candidateItemId === 'string')) && (value.snapshotId === undefined || value.snapshotId === null || (typeof value.snapshotId === 'string')) && (value.productId === undefined || value.productId === null || (typeof value.productId === 'string')) && (value.productPoolKey === undefined || value.productPoolKey === null || (typeof value.productPoolKey === 'string')) && (value.externalId === undefined || value.externalId === null || (typeof value.externalId === 'string')) && (value.title === undefined || value.title === null || (typeof value.title === 'string')) && (value.platformName === undefined || value.platformName === null || (typeof value.platformName === 'string')) && (value.currency === undefined || value.currency === null || (typeof value.currency === 'string')) && (value.shopName === undefined || value.shopName === null || (typeof value.shopName === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')) && (value.stockStatus === undefined || value.stockStatus === null || (typeof value.stockStatus === 'string')) && (value.coverImageUrl === undefined || value.coverImageUrl === null || (typeof value.coverImageUrl === 'string')) && (value.productUrl === undefined || value.productUrl === null || (typeof value.productUrl === 'string')) && (value.platformProductId === undefined || value.platformProductId === null || (typeof value.platformProductId === 'string')) && (value.platformBrandId === undefined || value.platformBrandId === null || (typeof value.platformBrandId === 'string')) && (value.createdAt === undefined || value.createdAt === null || (typeof value.createdAt === 'string')) && (value.rank === undefined || value.rank === null || (typeof value.rank === 'number' && Number.isSafeInteger(value.rank))) && (value.pageIndex === undefined || value.pageIndex === null || (typeof value.pageIndex === 'number' && Number.isSafeInteger(value.pageIndex))) && (value.amount === undefined || value.amount === null || ((typeof value.amount === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.amount)) || (typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount >= 0))) && (value.price === undefined || value.price === null || validShoppingCandidateSetV1ItemsItemPrice(value.price as ShoppingCandidateSetV1ItemsItemPrice)) && (value.matchSummary === undefined || value.matchSummary === null || value.matchSummary !== undefined) && (value.normalizedAttributes === undefined || value.normalizedAttributes === null || value.normalizedAttributes !== undefined) && (value.rawPayload === undefined || value.rawPayload === null || value.rawPayload !== undefined) && (value.attributes === undefined || value.attributes === null || value.attributes !== undefined) && (value.matchScore === undefined || value.matchScore === null || (typeof value.matchScore === 'number' && Number.isFinite(value.matchScore))) && (value.recommendationReason === undefined || value.recommendationReason === null || (Array.isArray(value.recommendationReason) && value.recommendationReason.every((item: string) => item === null || (typeof item === 'string')))) && (value.commerceMeta === undefined || value.commerceMeta === null || validShoppingCandidateSetV1ItemsItemCommerceMeta(value.commerceMeta as ShoppingCandidateSetV1ItemsItemCommerceMeta)) && (value.sortSignals === undefined || value.sortSignals === null || validShoppingCandidateSetV1ItemsItemSortSignals(value.sortSignals as ShoppingCandidateSetV1ItemsItemSortSignals)) && (value.decisionTags === undefined || value.decisionTags === null || (Array.isArray(value.decisionTags) && value.decisionTags.every((item: Object) => item === null || item !== undefined))) && (value.decisionSupport === undefined || value.decisionSupport === null || validShoppingCandidateSetV1ItemsItemDecisionSupport(value.decisionSupport as ShoppingCandidateSetV1ItemsItemDecisionSupport)) && (value.shop === undefined || value.shop === null || validShoppingCandidateSetV1ItemsItemShop(value.shop as ShoppingCandidateSetV1ItemsItemShop)) && (value.priceHistoryReference === undefined || value.priceHistoryReference === null || value.priceHistoryReference !== undefined) && (value.deliveryEtaReference === undefined || value.deliveryEtaReference === null || validShoppingCandidateSetV1ItemsItemDeliveryEtaReference(value.deliveryEtaReference as ShoppingCandidateSetV1ItemsItemDeliveryEtaReference)); }

export function validShoppingCandidateSetV1PageRefsItem(value: ShoppingCandidateSetV1PageRefsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingCandidateSetV1(value: ShoppingCandidateSetV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.snapshotId === undefined || value.snapshotId === null || (typeof value.snapshotId === 'string')) && (value.candidateSnapshotId === undefined || value.candidateSnapshotId === null || (typeof value.candidateSnapshotId === 'string')) && (value.sessionId === undefined || value.sessionId === null || (typeof value.sessionId === 'string')) && (value.createdAt === undefined || value.createdAt === null || (typeof value.createdAt === 'string')) && (value.indexVersion === undefined || value.indexVersion === null || (typeof value.indexVersion === 'string')) && (value.recallMethod === undefined || value.recallMethod === null || (typeof value.recallMethod === 'string')) && (value.turnIndex === undefined || value.turnIndex === null || (typeof value.turnIndex === 'number' && Number.isSafeInteger(value.turnIndex))) && (value.limit === undefined || value.limit === null || (typeof value.limit === 'number' && Number.isSafeInteger(value.limit))) && (value.totalCount === undefined || value.totalCount === null || (typeof value.totalCount === 'number' && Number.isSafeInteger(value.totalCount))) && (value.degraded === undefined || value.degraded === null || (typeof value.degraded === 'boolean')) && (value.appliedFilter === undefined || value.appliedFilter === null || validShoppingCandidateSetV1AppliedFilter(value.appliedFilter as ShoppingCandidateSetV1AppliedFilter)) && (value.items === undefined || value.items === null || (Array.isArray(value.items) && value.items.every((item: ShoppingCandidateSetV1ItemsItem) => item === null || validShoppingCandidateSetV1ItemsItem(item as ShoppingCandidateSetV1ItemsItem)))) && (value.pageRefs === undefined || value.pageRefs === null || (Array.isArray(value.pageRefs) && value.pageRefs.every((item: ShoppingCandidateSetV1PageRefsItem) => item === null || validShoppingCandidateSetV1PageRefsItem(item as ShoppingCandidateSetV1PageRefsItem)))) && (value.excludedKeys === undefined || value.excludedKeys === null || (Array.isArray(value.excludedKeys) && value.excludedKeys.every((item: string) => item === null || (typeof item === 'string')))) && (value.requiredInfo === undefined || value.requiredInfo === null || value.requiredInfo !== undefined) && (value.sortOptions === undefined || value.sortOptions === null || value.sortOptions !== undefined) && (value.searchProgress === undefined || value.searchProgress === null || value.searchProgress !== undefined) && (value.fallback === undefined || value.fallback === null || value.fallback !== undefined) && (value.cursor === undefined || value.cursor === null || value.cursor !== undefined); }

export function validShoppingPriceStockV1ItemsItem(value: ShoppingPriceStockV1ItemsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.productId === undefined || value.productId === null || (typeof value.productId === 'string')) && (value.candidateItemId === undefined || value.candidateItemId === null || (typeof value.candidateItemId === 'string')) && (value.currency === undefined || value.currency === null || (typeof value.currency === 'string')) && (value.stockStatus === undefined || value.stockStatus === null || (typeof value.stockStatus === 'string')) && (value.source === undefined || value.source === null || (typeof value.source === 'string')) && (value.sourceObservedAt === undefined || value.sourceObservedAt === null || (typeof value.sourceObservedAt === 'string')) && (value.catalogUpdatedAt === undefined || value.catalogUpdatedAt === null || (typeof value.catalogUpdatedAt === 'string')) && (value.fetchedAt === undefined || value.fetchedAt === null || (typeof value.fetchedAt === 'string')) && (value.freshness === undefined || value.freshness === null || (typeof value.freshness === 'string')) && (value.status === undefined || value.status === null || (typeof value.status === 'string')) && (value.reason === undefined || value.reason === null || (typeof value.reason === 'string')) && (value.amount === undefined || value.amount === null || ((typeof value.amount === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.amount)) || (typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount >= 0))); }

export function validShoppingPriceStockV1(value: ShoppingPriceStockV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.items === null || (Array.isArray(value.items) && value.items.every((item: ShoppingPriceStockV1ItemsItem) => item === null || validShoppingPriceStockV1ItemsItem(item as ShoppingPriceStockV1ItemsItem)))) && (value.source === undefined || value.source === null || (typeof value.source === 'string')) && (value.sourceObservedAt === undefined || value.sourceObservedAt === null || (typeof value.sourceObservedAt === 'string')) && (value.catalogUpdatedAt === undefined || value.catalogUpdatedAt === null || (typeof value.catalogUpdatedAt === 'string')) && (value.fetchedAt === undefined || value.fetchedAt === null || (typeof value.fetchedAt === 'string')) && (value.freshness === undefined || value.freshness === null || (typeof value.freshness === 'string')); }

export function validShoppingFiltersV1Preferences(value: ShoppingFiltersV1Preferences): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.shopTypes === undefined || value.shopTypes === null || (Array.isArray(value.shopTypes) && value.shopTypes.every((item: string) => item === null || (typeof item === 'string')))) && (value.brands === undefined || value.brands === null || (Array.isArray(value.brands) && value.brands.every((item: string) => item === null || (typeof item === 'string')))) && (value.colors === undefined || value.colors === null || (Array.isArray(value.colors) && value.colors.every((item: string) => item === null || (typeof item === 'string')))) && (value.platforms === undefined || value.platforms === null || (Array.isArray(value.platforms) && value.platforms.every((item: string) => item === null || (typeof item === 'string')))) && (value.priceDirection === undefined || value.priceDirection === null || (typeof value.priceDirection === 'string')); }

export function validShoppingFiltersV1FilterPatchPreferences(value: ShoppingFiltersV1FilterPatchPreferences): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.shopTypes === undefined || value.shopTypes === null || (Array.isArray(value.shopTypes) && value.shopTypes.every((item: string) => item === null || (typeof item === 'string')))) && (value.brands === undefined || value.brands === null || (Array.isArray(value.brands) && value.brands.every((item: string) => item === null || (typeof item === 'string')))) && (value.colors === undefined || value.colors === null || (Array.isArray(value.colors) && value.colors.every((item: string) => item === null || (typeof item === 'string')))) && (value.platforms === undefined || value.platforms === null || (Array.isArray(value.platforms) && value.platforms.every((item: string) => item === null || (typeof item === 'string')))) && (value.priceDirection === undefined || value.priceDirection === null || (typeof value.priceDirection === 'string')); }

export function validShoppingFiltersV1FilterPatch(value: ShoppingFiltersV1FilterPatch): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.priceMin === undefined || value.priceMin === null || ((typeof value.priceMin === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMin)) || (typeof value.priceMin === 'number' && Number.isFinite(value.priceMin) && value.priceMin >= 0))) && (value.priceMax === undefined || value.priceMax === null || ((typeof value.priceMax === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMax)) || (typeof value.priceMax === 'number' && Number.isFinite(value.priceMax) && value.priceMax >= 0))) && (value.priceTarget === undefined || value.priceTarget === null || ((typeof value.priceTarget === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTarget)) || (typeof value.priceTarget === 'number' && Number.isFinite(value.priceTarget) && value.priceTarget >= 0))) && (value.priceTolerance === undefined || value.priceTolerance === null || ((typeof value.priceTolerance === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTolerance)) || (typeof value.priceTolerance === 'number' && Number.isFinite(value.priceTolerance) && value.priceTolerance >= 0))) && (value.timeConstraintDays === undefined || value.timeConstraintDays === null || (typeof value.timeConstraintDays === 'number' && Number.isFinite(value.timeConstraintDays))) && (value.sizeMin === undefined || value.sizeMin === null || (typeof value.sizeMin === 'number' && Number.isFinite(value.sizeMin))) && (value.sizeMax === undefined || value.sizeMax === null || (typeof value.sizeMax === 'number' && Number.isFinite(value.sizeMax))) && (value.stockOnly === undefined || value.stockOnly === null || (typeof value.stockOnly === 'boolean')) && (value.freeShippingOnly === undefined || value.freeShippingOnly === null || (typeof value.freeShippingOnly === 'boolean')) && (value.urgentDeliveryPreferred === undefined || value.urgentDeliveryPreferred === null || (typeof value.urgentDeliveryPreferred === 'boolean')) && (value.sizeSystem === undefined || value.sizeSystem === null || (typeof value.sizeSystem === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')) && (value.categoryScope === undefined || value.categoryScope === null || (typeof value.categoryScope === 'string')) && (value.platformsInclude === undefined || value.platformsInclude === null || (Array.isArray(value.platformsInclude) && value.platformsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.platformsExclude === undefined || value.platformsExclude === null || (Array.isArray(value.platformsExclude) && value.platformsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsInclude === undefined || value.brandsInclude === null || (Array.isArray(value.brandsInclude) && value.brandsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsExclude === undefined || value.brandsExclude === null || (Array.isArray(value.brandsExclude) && value.brandsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsInclude === undefined || value.colorsInclude === null || (Array.isArray(value.colorsInclude) && value.colorsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsExclude === undefined || value.colorsExclude === null || (Array.isArray(value.colorsExclude) && value.colorsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.sizesInclude === undefined || value.sizesInclude === null || (Array.isArray(value.sizesInclude) && value.sizesInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedProductIds === undefined || value.excludedProductIds === null || (Array.isArray(value.excludedProductIds) && value.excludedProductIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedCandidateItemIds === undefined || value.excludedCandidateItemIds === null || (Array.isArray(value.excludedCandidateItemIds) && value.excludedCandidateItemIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.sortRule === undefined || value.sortRule === null || (typeof value.sortRule === 'string' && ["price_asc","price_desc","relevance_desc","rating_desc","delivery_asc"].indexOf(value.sortRule) >= 0)) && (value.preferences === undefined || value.preferences === null || validShoppingFiltersV1FilterPatchPreferences(value.preferences as ShoppingFiltersV1FilterPatchPreferences)); }

export function validShoppingFiltersV1OperationsItem(value: ShoppingFiltersV1OperationsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.kind === undefined || value.kind === null || (typeof value.kind === 'string')) && (value.field === undefined || value.field === null || (typeof value.field === 'string')) && (value.value === undefined || value.value === null || (typeof value.value === 'string')) && (value.span === undefined || value.span === null || (typeof value.span === 'string')) && (value.polarity === undefined || value.polarity === null || (typeof value.polarity === 'string')) && (value.source === undefined || value.source === null || (typeof value.source === 'string')) && (value.values === undefined || value.values === null || (Array.isArray(value.values) && value.values.every((item: string) => item === null || (typeof item === 'string')))) && (value.confidence === undefined || value.confidence === null || (typeof value.confidence === 'number' && Number.isFinite(value.confidence))); }

export function validShoppingFiltersV1(value: ShoppingFiltersV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.priceMin === undefined || value.priceMin === null || ((typeof value.priceMin === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMin)) || (typeof value.priceMin === 'number' && Number.isFinite(value.priceMin) && value.priceMin >= 0))) && (value.priceMax === undefined || value.priceMax === null || ((typeof value.priceMax === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMax)) || (typeof value.priceMax === 'number' && Number.isFinite(value.priceMax) && value.priceMax >= 0))) && (value.priceTarget === undefined || value.priceTarget === null || ((typeof value.priceTarget === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTarget)) || (typeof value.priceTarget === 'number' && Number.isFinite(value.priceTarget) && value.priceTarget >= 0))) && (value.priceTolerance === undefined || value.priceTolerance === null || ((typeof value.priceTolerance === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTolerance)) || (typeof value.priceTolerance === 'number' && Number.isFinite(value.priceTolerance) && value.priceTolerance >= 0))) && (value.timeConstraintDays === undefined || value.timeConstraintDays === null || (typeof value.timeConstraintDays === 'number' && Number.isFinite(value.timeConstraintDays))) && (value.sizeMin === undefined || value.sizeMin === null || (typeof value.sizeMin === 'number' && Number.isFinite(value.sizeMin))) && (value.sizeMax === undefined || value.sizeMax === null || (typeof value.sizeMax === 'number' && Number.isFinite(value.sizeMax))) && (value.stockOnly === undefined || value.stockOnly === null || (typeof value.stockOnly === 'boolean')) && (value.freeShippingOnly === undefined || value.freeShippingOnly === null || (typeof value.freeShippingOnly === 'boolean')) && (value.urgentDeliveryPreferred === undefined || value.urgentDeliveryPreferred === null || (typeof value.urgentDeliveryPreferred === 'boolean')) && (value.sizeSystem === undefined || value.sizeSystem === null || (typeof value.sizeSystem === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')) && (value.categoryScope === undefined || value.categoryScope === null || (typeof value.categoryScope === 'string')) && (value.platformsInclude === undefined || value.platformsInclude === null || (Array.isArray(value.platformsInclude) && value.platformsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.platformsExclude === undefined || value.platformsExclude === null || (Array.isArray(value.platformsExclude) && value.platformsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsInclude === undefined || value.brandsInclude === null || (Array.isArray(value.brandsInclude) && value.brandsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsExclude === undefined || value.brandsExclude === null || (Array.isArray(value.brandsExclude) && value.brandsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsInclude === undefined || value.colorsInclude === null || (Array.isArray(value.colorsInclude) && value.colorsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsExclude === undefined || value.colorsExclude === null || (Array.isArray(value.colorsExclude) && value.colorsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.sizesInclude === undefined || value.sizesInclude === null || (Array.isArray(value.sizesInclude) && value.sizesInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedProductIds === undefined || value.excludedProductIds === null || (Array.isArray(value.excludedProductIds) && value.excludedProductIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedCandidateItemIds === undefined || value.excludedCandidateItemIds === null || (Array.isArray(value.excludedCandidateItemIds) && value.excludedCandidateItemIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.sortRule === undefined || value.sortRule === null || (typeof value.sortRule === 'string' && ["price_asc","price_desc","relevance_desc","rating_desc","delivery_asc"].indexOf(value.sortRule) >= 0)) && (value.preferences === undefined || value.preferences === null || validShoppingFiltersV1Preferences(value.preferences as ShoppingFiltersV1Preferences)) && (value.filterPatch === undefined || value.filterPatch === null || validShoppingFiltersV1FilterPatch(value.filterPatch as ShoppingFiltersV1FilterPatch)) && (value.filterRemove === undefined || value.filterRemove === null || (Array.isArray(value.filterRemove) && value.filterRemove.every((item: string) => item === null || (typeof item === 'string')))) && (value.shouldResetPreviousFilters === undefined || value.shouldResetPreviousFilters === null || (typeof value.shouldResetPreviousFilters === 'boolean')) && (value.operations === undefined || value.operations === null || (Array.isArray(value.operations) && value.operations.every((item: ShoppingFiltersV1OperationsItem) => item === null || validShoppingFiltersV1OperationsItem(item as ShoppingFiltersV1OperationsItem)))); }

export function validShoppingSessionV1ProfileRef(value: ShoppingSessionV1ProfileRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingSessionV1FilterRef(value: ShoppingSessionV1FilterRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingSessionV1CandidateRef(value: ShoppingSessionV1CandidateRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingSessionV1PreprocessRef(value: ShoppingSessionV1PreprocessRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingSessionV1CursorRef(value: ShoppingSessionV1CursorRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingSessionV1ConversationRef(value: ShoppingSessionV1ConversationRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingSessionV1(value: ShoppingSessionV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.sessionId === null || (typeof value.sessionId === 'string')) && (value.owner === undefined || value.owner === null || (typeof value.owner === 'string')) && (value.userId === undefined || value.userId === null || (typeof value.userId === 'string')) && (value.assetId === undefined || value.assetId === null || (typeof value.assetId === 'string')) && (value.status === undefined || value.status === null || (typeof value.status === 'string')) && (value.stage === undefined || value.stage === null || (typeof value.stage === 'string')) && (value.entrySource === undefined || value.entrySource === null || (typeof value.entrySource === 'string')) && (value.categoryHint === undefined || value.categoryHint === null || (typeof value.categoryHint === 'string')) && (value.startedAt === undefined || value.startedAt === null || (typeof value.startedAt === 'string')) && (value.lastActiveAt === undefined || value.lastActiveAt === null || (typeof value.lastActiveAt === 'string')) && (value.currentTurnIndex === undefined || value.currentTurnIndex === null || (typeof value.currentTurnIndex === 'number' && Number.isSafeInteger(value.currentTurnIndex))) && (value.stateVersion === undefined || value.stateVersion === null || (typeof value.stateVersion === 'number' && Number.isSafeInteger(value.stateVersion))) && (value.requestRevision === undefined || value.requestRevision === null || (typeof value.requestRevision === 'number' && Number.isSafeInteger(value.requestRevision))) && (value.degraded === undefined || value.degraded === null || (typeof value.degraded === 'boolean')) && (value.profileRef === undefined || value.profileRef === null || validShoppingSessionV1ProfileRef(value.profileRef as ShoppingSessionV1ProfileRef)) && (value.filterRef === undefined || value.filterRef === null || validShoppingSessionV1FilterRef(value.filterRef as ShoppingSessionV1FilterRef)) && (value.candidateRef === undefined || value.candidateRef === null || validShoppingSessionV1CandidateRef(value.candidateRef as ShoppingSessionV1CandidateRef)) && (value.preprocessRef === undefined || value.preprocessRef === null || validShoppingSessionV1PreprocessRef(value.preprocessRef as ShoppingSessionV1PreprocessRef)) && (value.cursorRef === undefined || value.cursorRef === null || validShoppingSessionV1CursorRef(value.cursorRef as ShoppingSessionV1CursorRef)) && (value.conversationRef === undefined || value.conversationRef === null || validShoppingSessionV1ConversationRef(value.conversationRef as ShoppingSessionV1ConversationRef)); }

export function validShoppingPaginationV1(value: ShoppingPaginationV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.cursorId === null || (typeof value.cursorId === 'string')) && (value.sessionId === null || (typeof value.sessionId === 'string')) && (value.candidateSnapshotId === undefined || value.candidateSnapshotId === null || (typeof value.candidateSnapshotId === 'string')) && (value.preprocessSnapshotId === undefined || value.preprocessSnapshotId === null || (typeof value.preprocessSnapshotId === 'string')) && (value.filterHash === null || (typeof value.filterHash === 'string')) && (value.sortRule === undefined || value.sortRule === null || (typeof value.sortRule === 'string')) && (value.expiresAt === undefined || value.expiresAt === null || (typeof value.expiresAt === 'string')) && (value.indexVersion === undefined || value.indexVersion === null || (typeof value.indexVersion === 'string')) && (value.queryHash === undefined || value.queryHash === null || (typeof value.queryHash === 'string')) && (value.offset === undefined || value.offset === null || (typeof value.offset === 'number' && Number.isSafeInteger(value.offset))) && (value.limit === undefined || value.limit === null || (typeof value.limit === 'number' && Number.isSafeInteger(value.limit))) && (value.exhausted === undefined || value.exhausted === null || (typeof value.exhausted === 'boolean')) && (value.raw === undefined || value.raw === null || value.raw !== undefined); }

export function validShoppingAnswerV1EvidenceRefsItem(value: ShoppingAnswerV1EvidenceRefsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingAnswerV1ProfilePatch(value: ShoppingAnswerV1ProfilePatch): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.category === null || (typeof value.category === 'string')) && (value.brand === undefined || value.brand === null || (typeof value.brand === 'string')) && (value.modelLine === undefined || value.modelLine === null || (typeof value.modelLine === 'string')) && (value.colorFamily === undefined || value.colorFamily === null || (typeof value.colorFamily === 'string')) && (value.colorway === undefined || value.colorway === null || (typeof value.colorway === 'string')) && (value.shoeType === undefined || value.shoeType === null || (typeof value.shoeType === 'string')) && (value.size === undefined || value.size === null || (typeof value.size === 'string')) && (value.color === undefined || value.color === null || (typeof value.color === 'string')) && (value.modelVersion === undefined || value.modelVersion === null || (typeof value.modelVersion === 'string')) && (value.profileVersion === undefined || value.profileVersion === null || (typeof value.profileVersion === 'string')) && (value.styleTags === undefined || value.styleTags === null || (Array.isArray(value.styleTags) && value.styleTags.every((item: string) => item === null || (typeof item === 'string')))) && (value.sceneTags === undefined || value.sceneTags === null || (Array.isArray(value.sceneTags) && value.sceneTags.every((item: string) => item === null || (typeof item === 'string')))) && (value.keywords === undefined || value.keywords === null || (Array.isArray(value.keywords) && value.keywords.every((item: string) => item === null || (typeof item === 'string')))) && (value.confidence === undefined || value.confidence === null || (typeof value.confidence === 'number' && Number.isFinite(value.confidence))) && (value.raw === undefined || value.raw === null || value.raw !== undefined); }

export function validShoppingAnswerV1FilterPatchPreferences(value: ShoppingAnswerV1FilterPatchPreferences): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.shopTypes === undefined || value.shopTypes === null || (Array.isArray(value.shopTypes) && value.shopTypes.every((item: string) => item === null || (typeof item === 'string')))) && (value.brands === undefined || value.brands === null || (Array.isArray(value.brands) && value.brands.every((item: string) => item === null || (typeof item === 'string')))) && (value.colors === undefined || value.colors === null || (Array.isArray(value.colors) && value.colors.every((item: string) => item === null || (typeof item === 'string')))) && (value.platforms === undefined || value.platforms === null || (Array.isArray(value.platforms) && value.platforms.every((item: string) => item === null || (typeof item === 'string')))) && (value.priceDirection === undefined || value.priceDirection === null || (typeof value.priceDirection === 'string')); }

export function validShoppingAnswerV1FilterPatch(value: ShoppingAnswerV1FilterPatch): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.priceMin === undefined || value.priceMin === null || ((typeof value.priceMin === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMin)) || (typeof value.priceMin === 'number' && Number.isFinite(value.priceMin) && value.priceMin >= 0))) && (value.priceMax === undefined || value.priceMax === null || ((typeof value.priceMax === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMax)) || (typeof value.priceMax === 'number' && Number.isFinite(value.priceMax) && value.priceMax >= 0))) && (value.priceTarget === undefined || value.priceTarget === null || ((typeof value.priceTarget === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTarget)) || (typeof value.priceTarget === 'number' && Number.isFinite(value.priceTarget) && value.priceTarget >= 0))) && (value.priceTolerance === undefined || value.priceTolerance === null || ((typeof value.priceTolerance === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTolerance)) || (typeof value.priceTolerance === 'number' && Number.isFinite(value.priceTolerance) && value.priceTolerance >= 0))) && (value.timeConstraintDays === undefined || value.timeConstraintDays === null || (typeof value.timeConstraintDays === 'number' && Number.isFinite(value.timeConstraintDays))) && (value.sizeMin === undefined || value.sizeMin === null || (typeof value.sizeMin === 'number' && Number.isFinite(value.sizeMin))) && (value.sizeMax === undefined || value.sizeMax === null || (typeof value.sizeMax === 'number' && Number.isFinite(value.sizeMax))) && (value.stockOnly === undefined || value.stockOnly === null || (typeof value.stockOnly === 'boolean')) && (value.freeShippingOnly === undefined || value.freeShippingOnly === null || (typeof value.freeShippingOnly === 'boolean')) && (value.urgentDeliveryPreferred === undefined || value.urgentDeliveryPreferred === null || (typeof value.urgentDeliveryPreferred === 'boolean')) && (value.sizeSystem === undefined || value.sizeSystem === null || (typeof value.sizeSystem === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')) && (value.categoryScope === undefined || value.categoryScope === null || (typeof value.categoryScope === 'string')) && (value.platformsInclude === undefined || value.platformsInclude === null || (Array.isArray(value.platformsInclude) && value.platformsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.platformsExclude === undefined || value.platformsExclude === null || (Array.isArray(value.platformsExclude) && value.platformsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsInclude === undefined || value.brandsInclude === null || (Array.isArray(value.brandsInclude) && value.brandsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsExclude === undefined || value.brandsExclude === null || (Array.isArray(value.brandsExclude) && value.brandsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsInclude === undefined || value.colorsInclude === null || (Array.isArray(value.colorsInclude) && value.colorsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsExclude === undefined || value.colorsExclude === null || (Array.isArray(value.colorsExclude) && value.colorsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.sizesInclude === undefined || value.sizesInclude === null || (Array.isArray(value.sizesInclude) && value.sizesInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedProductIds === undefined || value.excludedProductIds === null || (Array.isArray(value.excludedProductIds) && value.excludedProductIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedCandidateItemIds === undefined || value.excludedCandidateItemIds === null || (Array.isArray(value.excludedCandidateItemIds) && value.excludedCandidateItemIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.sortRule === undefined || value.sortRule === null || (typeof value.sortRule === 'string' && ["price_asc","price_desc","relevance_desc","rating_desc","delivery_asc"].indexOf(value.sortRule) >= 0)) && (value.preferences === undefined || value.preferences === null || validShoppingAnswerV1FilterPatchPreferences(value.preferences as ShoppingAnswerV1FilterPatchPreferences)); }

export function validShoppingAnswerV1(value: ShoppingAnswerV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.assistantMessage === undefined || value.assistantMessage === null || (typeof value.assistantMessage === 'string')) && (value.intent === undefined || value.intent === null || (typeof value.intent === 'string')) && (value.clarification === undefined || value.clarification === null || (typeof value.clarification === 'string')) && (value.source === undefined || value.source === null || (typeof value.source === 'string')) && (value.conversationSummary === undefined || value.conversationSummary === null || (typeof value.conversationSummary === 'string')) && (value.evidenceRefs === undefined || value.evidenceRefs === null || (Array.isArray(value.evidenceRefs) && value.evidenceRefs.every((item: ShoppingAnswerV1EvidenceRefsItem) => item === null || validShoppingAnswerV1EvidenceRefsItem(item as ShoppingAnswerV1EvidenceRefsItem)))) && (value.candidateComparisons === undefined || value.candidateComparisons === null || (Array.isArray(value.candidateComparisons) && value.candidateComparisons.every((item: Object) => item === null || item !== undefined))) && (value.rejectedOperations === undefined || value.rejectedOperations === null || (Array.isArray(value.rejectedOperations) && value.rejectedOperations.every((item: Object) => item === null || item !== undefined))) && (value.filterRemove === undefined || value.filterRemove === null || (Array.isArray(value.filterRemove) && value.filterRemove.every((item: Object) => item === null || item !== undefined))) && (value.operations === undefined || value.operations === null || (Array.isArray(value.operations) && value.operations.every((item: Object) => item === null || item !== undefined))) && (value.profilePatch === undefined || value.profilePatch === null || validShoppingAnswerV1ProfilePatch(value.profilePatch as ShoppingAnswerV1ProfilePatch)) && (value.filterPatch === undefined || value.filterPatch === null || validShoppingAnswerV1FilterPatch(value.filterPatch as ShoppingAnswerV1FilterPatch)) && (value.shouldResetPreviousFilters === undefined || value.shouldResetPreviousFilters === null || (typeof value.shouldResetPreviousFilters === 'boolean')) && (value.degraded === undefined || value.degraded === null || (typeof value.degraded === 'boolean')) && (value.turnIndex === undefined || value.turnIndex === null || (typeof value.turnIndex === 'number' && Number.isSafeInteger(value.turnIndex))); }

export function validShoppingUserContextV1ProfileBlocksItem(value: ShoppingUserContextV1ProfileBlocksItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.scope === undefined || value.scope === null || (typeof value.scope === 'string')) && (value.schema === undefined || value.schema === null || (typeof value.schema === 'string')) && (value.status === undefined || value.status === null || (typeof value.status === 'string')) && (value.source === undefined || value.source === null || (typeof value.source === 'string')) && (value.sensitivity === undefined || value.sensitivity === null || (typeof value.sensitivity === 'string')) && (value.confidence === undefined || value.confidence === null || (typeof value.confidence === 'number' && Number.isFinite(value.confidence))) && (value.value === undefined || value.value === null || value.value !== undefined); }

export function validShoppingUserContextV1MemoryProposalsItem(value: ShoppingUserContextV1MemoryProposalsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.proposalId === undefined || value.proposalId === null || (typeof value.proposalId === 'string')) && (value.status === undefined || value.status === null || (typeof value.status === 'string')) && (value.confirmed === undefined || value.confirmed === null || (typeof value.confirmed === 'boolean')); }

export function validShoppingUserContextV1CartRefsItem(value: ShoppingUserContextV1CartRefsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingUserContextV1ShortlistRefsItem(value: ShoppingUserContextV1ShortlistRefsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingUserContextV1FavoriteRefsItem(value: ShoppingUserContextV1FavoriteRefsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingUserContextV1HistoryRefsItem(value: ShoppingUserContextV1HistoryRefsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingUserContextV1FeedbackRefsItem(value: ShoppingUserContextV1FeedbackRefsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingUserContextV1(value: ShoppingUserContextV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.profileBlocks === undefined || value.profileBlocks === null || (Array.isArray(value.profileBlocks) && value.profileBlocks.every((item: ShoppingUserContextV1ProfileBlocksItem) => item === null || validShoppingUserContextV1ProfileBlocksItem(item as ShoppingUserContextV1ProfileBlocksItem)))) && (value.memoryProposals === undefined || value.memoryProposals === null || (Array.isArray(value.memoryProposals) && value.memoryProposals.every((item: ShoppingUserContextV1MemoryProposalsItem) => item === null || validShoppingUserContextV1MemoryProposalsItem(item as ShoppingUserContextV1MemoryProposalsItem)))) && (value.authorizedScopes === undefined || value.authorizedScopes === null || (Array.isArray(value.authorizedScopes) && value.authorizedScopes.every((item: string) => item === null || (typeof item === 'string')))) && (value.cartRefs === undefined || value.cartRefs === null || (Array.isArray(value.cartRefs) && value.cartRefs.every((item: ShoppingUserContextV1CartRefsItem) => item === null || validShoppingUserContextV1CartRefsItem(item as ShoppingUserContextV1CartRefsItem)))) && (value.shortlistRefs === undefined || value.shortlistRefs === null || (Array.isArray(value.shortlistRefs) && value.shortlistRefs.every((item: ShoppingUserContextV1ShortlistRefsItem) => item === null || validShoppingUserContextV1ShortlistRefsItem(item as ShoppingUserContextV1ShortlistRefsItem)))) && (value.favoriteRefs === undefined || value.favoriteRefs === null || (Array.isArray(value.favoriteRefs) && value.favoriteRefs.every((item: ShoppingUserContextV1FavoriteRefsItem) => item === null || validShoppingUserContextV1FavoriteRefsItem(item as ShoppingUserContextV1FavoriteRefsItem)))) && (value.historyRefs === undefined || value.historyRefs === null || (Array.isArray(value.historyRefs) && value.historyRefs.every((item: ShoppingUserContextV1HistoryRefsItem) => item === null || validShoppingUserContextV1HistoryRefsItem(item as ShoppingUserContextV1HistoryRefsItem)))) && (value.feedbackRefs === undefined || value.feedbackRefs === null || (Array.isArray(value.feedbackRefs) && value.feedbackRefs.every((item: ShoppingUserContextV1FeedbackRefsItem) => item === null || validShoppingUserContextV1FeedbackRefsItem(item as ShoppingUserContextV1FeedbackRefsItem)))); }

export function validShoppingResultV1SessionProfileRef(value: ShoppingResultV1SessionProfileRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingResultV1SessionFilterRef(value: ShoppingResultV1SessionFilterRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingResultV1SessionCandidateRef(value: ShoppingResultV1SessionCandidateRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingResultV1SessionPreprocessRef(value: ShoppingResultV1SessionPreprocessRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingResultV1SessionCursorRef(value: ShoppingResultV1SessionCursorRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingResultV1SessionConversationRef(value: ShoppingResultV1SessionConversationRef): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingResultV1Session(value: ShoppingResultV1Session): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.sessionId === null || (typeof value.sessionId === 'string')) && (value.owner === undefined || value.owner === null || (typeof value.owner === 'string')) && (value.userId === undefined || value.userId === null || (typeof value.userId === 'string')) && (value.assetId === undefined || value.assetId === null || (typeof value.assetId === 'string')) && (value.status === undefined || value.status === null || (typeof value.status === 'string')) && (value.stage === undefined || value.stage === null || (typeof value.stage === 'string')) && (value.entrySource === undefined || value.entrySource === null || (typeof value.entrySource === 'string')) && (value.categoryHint === undefined || value.categoryHint === null || (typeof value.categoryHint === 'string')) && (value.startedAt === undefined || value.startedAt === null || (typeof value.startedAt === 'string')) && (value.lastActiveAt === undefined || value.lastActiveAt === null || (typeof value.lastActiveAt === 'string')) && (value.currentTurnIndex === undefined || value.currentTurnIndex === null || (typeof value.currentTurnIndex === 'number' && Number.isSafeInteger(value.currentTurnIndex))) && (value.stateVersion === undefined || value.stateVersion === null || (typeof value.stateVersion === 'number' && Number.isSafeInteger(value.stateVersion))) && (value.requestRevision === undefined || value.requestRevision === null || (typeof value.requestRevision === 'number' && Number.isSafeInteger(value.requestRevision))) && (value.degraded === undefined || value.degraded === null || (typeof value.degraded === 'boolean')) && (value.profileRef === undefined || value.profileRef === null || validShoppingResultV1SessionProfileRef(value.profileRef as ShoppingResultV1SessionProfileRef)) && (value.filterRef === undefined || value.filterRef === null || validShoppingResultV1SessionFilterRef(value.filterRef as ShoppingResultV1SessionFilterRef)) && (value.candidateRef === undefined || value.candidateRef === null || validShoppingResultV1SessionCandidateRef(value.candidateRef as ShoppingResultV1SessionCandidateRef)) && (value.preprocessRef === undefined || value.preprocessRef === null || validShoppingResultV1SessionPreprocessRef(value.preprocessRef as ShoppingResultV1SessionPreprocessRef)) && (value.cursorRef === undefined || value.cursorRef === null || validShoppingResultV1SessionCursorRef(value.cursorRef as ShoppingResultV1SessionCursorRef)) && (value.conversationRef === undefined || value.conversationRef === null || validShoppingResultV1SessionConversationRef(value.conversationRef as ShoppingResultV1SessionConversationRef)); }

export function validShoppingResultV1CandidatesAppliedFilterPreferences(value: ShoppingResultV1CandidatesAppliedFilterPreferences): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.shopTypes === undefined || value.shopTypes === null || (Array.isArray(value.shopTypes) && value.shopTypes.every((item: string) => item === null || (typeof item === 'string')))) && (value.brands === undefined || value.brands === null || (Array.isArray(value.brands) && value.brands.every((item: string) => item === null || (typeof item === 'string')))) && (value.colors === undefined || value.colors === null || (Array.isArray(value.colors) && value.colors.every((item: string) => item === null || (typeof item === 'string')))) && (value.platforms === undefined || value.platforms === null || (Array.isArray(value.platforms) && value.platforms.every((item: string) => item === null || (typeof item === 'string')))) && (value.priceDirection === undefined || value.priceDirection === null || (typeof value.priceDirection === 'string')); }

export function validShoppingResultV1CandidatesAppliedFilter(value: ShoppingResultV1CandidatesAppliedFilter): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.priceMin === undefined || value.priceMin === null || ((typeof value.priceMin === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMin)) || (typeof value.priceMin === 'number' && Number.isFinite(value.priceMin) && value.priceMin >= 0))) && (value.priceMax === undefined || value.priceMax === null || ((typeof value.priceMax === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMax)) || (typeof value.priceMax === 'number' && Number.isFinite(value.priceMax) && value.priceMax >= 0))) && (value.priceTarget === undefined || value.priceTarget === null || ((typeof value.priceTarget === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTarget)) || (typeof value.priceTarget === 'number' && Number.isFinite(value.priceTarget) && value.priceTarget >= 0))) && (value.priceTolerance === undefined || value.priceTolerance === null || ((typeof value.priceTolerance === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTolerance)) || (typeof value.priceTolerance === 'number' && Number.isFinite(value.priceTolerance) && value.priceTolerance >= 0))) && (value.timeConstraintDays === undefined || value.timeConstraintDays === null || (typeof value.timeConstraintDays === 'number' && Number.isFinite(value.timeConstraintDays))) && (value.sizeMin === undefined || value.sizeMin === null || (typeof value.sizeMin === 'number' && Number.isFinite(value.sizeMin))) && (value.sizeMax === undefined || value.sizeMax === null || (typeof value.sizeMax === 'number' && Number.isFinite(value.sizeMax))) && (value.stockOnly === undefined || value.stockOnly === null || (typeof value.stockOnly === 'boolean')) && (value.freeShippingOnly === undefined || value.freeShippingOnly === null || (typeof value.freeShippingOnly === 'boolean')) && (value.urgentDeliveryPreferred === undefined || value.urgentDeliveryPreferred === null || (typeof value.urgentDeliveryPreferred === 'boolean')) && (value.sizeSystem === undefined || value.sizeSystem === null || (typeof value.sizeSystem === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')) && (value.categoryScope === undefined || value.categoryScope === null || (typeof value.categoryScope === 'string')) && (value.platformsInclude === undefined || value.platformsInclude === null || (Array.isArray(value.platformsInclude) && value.platformsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.platformsExclude === undefined || value.platformsExclude === null || (Array.isArray(value.platformsExclude) && value.platformsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsInclude === undefined || value.brandsInclude === null || (Array.isArray(value.brandsInclude) && value.brandsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsExclude === undefined || value.brandsExclude === null || (Array.isArray(value.brandsExclude) && value.brandsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsInclude === undefined || value.colorsInclude === null || (Array.isArray(value.colorsInclude) && value.colorsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsExclude === undefined || value.colorsExclude === null || (Array.isArray(value.colorsExclude) && value.colorsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.sizesInclude === undefined || value.sizesInclude === null || (Array.isArray(value.sizesInclude) && value.sizesInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedProductIds === undefined || value.excludedProductIds === null || (Array.isArray(value.excludedProductIds) && value.excludedProductIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedCandidateItemIds === undefined || value.excludedCandidateItemIds === null || (Array.isArray(value.excludedCandidateItemIds) && value.excludedCandidateItemIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.sortRule === undefined || value.sortRule === null || (typeof value.sortRule === 'string' && ["price_asc","price_desc","relevance_desc","rating_desc","delivery_asc"].indexOf(value.sortRule) >= 0)) && (value.preferences === undefined || value.preferences === null || validShoppingResultV1CandidatesAppliedFilterPreferences(value.preferences as ShoppingResultV1CandidatesAppliedFilterPreferences)); }

export function validShoppingResultV1CandidatesItemsItemPrice(value: ShoppingResultV1CandidatesItemsItemPrice): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.amount === undefined || value.amount === null || ((typeof value.amount === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.amount)) || (typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount >= 0))) && (value.currency === undefined || value.currency === null || (typeof value.currency === 'string')); }

export function validShoppingResultV1CandidatesItemsItemCommerceMetaRating(value: ShoppingResultV1CandidatesItemsItemCommerceMetaRating): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.overall === undefined || value.overall === null || (typeof value.overall === 'number' && Number.isFinite(value.overall))) && (value.productQuality === undefined || value.productQuality === null || (typeof value.productQuality === 'number' && Number.isFinite(value.productQuality))) && (value.logisticsSpeed === undefined || value.logisticsSpeed === null || (typeof value.logisticsSpeed === 'number' && Number.isFinite(value.logisticsSpeed))) && (value.service === undefined || value.service === null || (typeof value.service === 'number' && Number.isFinite(value.service))); }

export function validShoppingResultV1CandidatesItemsItemCommerceMetaDelivery(value: ShoppingResultV1CandidatesItemsItemCommerceMetaDelivery): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.shipFrom === undefined || value.shipFrom === null || (typeof value.shipFrom === 'string')) && (value.shipTimeText === undefined || value.shipTimeText === null || (typeof value.shipTimeText === 'string')) && (value.deliveryTimeText === undefined || value.deliveryTimeText === null || (typeof value.deliveryTimeText === 'string')) && (value.deliveryDays === undefined || value.deliveryDays === null || (typeof value.deliveryDays === 'number' && Number.isFinite(value.deliveryDays))) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.returnShippingInsurance === undefined || value.returnShippingInsurance === null || (typeof value.returnShippingInsurance === 'boolean')) && (value.sevenDayNoReasonReturn === undefined || value.sevenDayNoReasonReturn === null || (typeof value.sevenDayNoReasonReturn === 'boolean')) && (value.serviceLabels === undefined || value.serviceLabels === null || (Array.isArray(value.serviceLabels) && value.serviceLabels.every((item: string) => item === null || (typeof item === 'string')))); }

export function validShoppingResultV1CandidatesItemsItemCommerceMetaSku(value: ShoppingResultV1CandidatesItemsItemCommerceMetaSku): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.availableSizes === undefined || value.availableSizes === null || (Array.isArray(value.availableSizes) && value.availableSizes.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorOptions === undefined || value.colorOptions === null || (Array.isArray(value.colorOptions) && value.colorOptions.every((item: string) => item === null || (typeof item === 'string')))) && (value.hasSkuMatrix === undefined || value.hasSkuMatrix === null || (typeof value.hasSkuMatrix === 'boolean')); }

export function validShoppingResultV1CandidatesItemsItemCommerceMetaPaymentSupportedMethodsItem(value: ShoppingResultV1CandidatesItemsItemCommerceMetaPaymentSupportedMethodsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.code === null || (typeof value.code === 'string')) && (value.label === null || (typeof value.label === 'string')); }

export function validShoppingResultV1CandidatesItemsItemCommerceMetaPayment(value: ShoppingResultV1CandidatesItemsItemCommerceMetaPayment): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.checkoutMode === undefined || value.checkoutMode === null || (typeof value.checkoutMode === 'string')) && (value.productUrl === undefined || value.productUrl === null || (typeof value.productUrl === 'string')) && (value.supportedMethods === undefined || value.supportedMethods === null || (Array.isArray(value.supportedMethods) && value.supportedMethods.every((item: ShoppingResultV1CandidatesItemsItemCommerceMetaPaymentSupportedMethodsItem) => item === null || validShoppingResultV1CandidatesItemsItemCommerceMetaPaymentSupportedMethodsItem(item as ShoppingResultV1CandidatesItemsItemCommerceMetaPaymentSupportedMethodsItem)))); }

export function validShoppingResultV1CandidatesItemsItemCommerceMeta(value: ShoppingResultV1CandidatesItemsItemCommerceMeta): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.rating === undefined || value.rating === null || validShoppingResultV1CandidatesItemsItemCommerceMetaRating(value.rating as ShoppingResultV1CandidatesItemsItemCommerceMetaRating)) && (value.delivery === undefined || value.delivery === null || validShoppingResultV1CandidatesItemsItemCommerceMetaDelivery(value.delivery as ShoppingResultV1CandidatesItemsItemCommerceMetaDelivery)) && (value.sku === undefined || value.sku === null || validShoppingResultV1CandidatesItemsItemCommerceMetaSku(value.sku as ShoppingResultV1CandidatesItemsItemCommerceMetaSku)) && (value.payment === undefined || value.payment === null || validShoppingResultV1CandidatesItemsItemCommerceMetaPayment(value.payment as ShoppingResultV1CandidatesItemsItemCommerceMetaPayment)); }

export function validShoppingResultV1CandidatesItemsItemSortSignals(value: ShoppingResultV1CandidatesItemsItemSortSignals): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.backendRank === undefined || value.backendRank === null || (typeof value.backendRank === 'number' && Number.isFinite(value.backendRank))) && (value.priceAmount === undefined || value.priceAmount === null || (typeof value.priceAmount === 'number' && Number.isFinite(value.priceAmount))) && (value.relevanceScore === undefined || value.relevanceScore === null || (typeof value.relevanceScore === 'number' && Number.isFinite(value.relevanceScore))) && (value.displayScore === undefined || value.displayScore === null || (typeof value.displayScore === 'number' && Number.isFinite(value.displayScore))) && (value.visualMatchConfidence === undefined || value.visualMatchConfidence === null || (typeof value.visualMatchConfidence === 'number' && Number.isFinite(value.visualMatchConfidence))) && (value.annScore === undefined || value.annScore === null || (typeof value.annScore === 'number' && Number.isFinite(value.annScore))) && (value.ratingScore === undefined || value.ratingScore === null || (typeof value.ratingScore === 'number' && Number.isFinite(value.ratingScore))) && (value.deliveryDays === undefined || value.deliveryDays === null || (typeof value.deliveryDays === 'number' && Number.isFinite(value.deliveryDays))) && (value.stockRank === undefined || value.stockRank === null || (typeof value.stockRank === 'number' && Number.isFinite(value.stockRank))); }

export function validShoppingResultV1CandidatesItemsItemDecisionSupport(value: ShoppingResultV1CandidatesItemsItemDecisionSupport): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.priceConclusion === undefined || value.priceConclusion === null || (typeof value.priceConclusion === 'string')) && (value.stockConclusion === undefined || value.stockConclusion === null || (typeof value.stockConclusion === 'string')) && (value.shopConclusion === undefined || value.shopConclusion === null || (typeof value.shopConclusion === 'string')) && (value.ratingConclusion === undefined || value.ratingConclusion === null || (typeof value.ratingConclusion === 'string')) && (value.deliveryConclusion === undefined || value.deliveryConclusion === null || (typeof value.deliveryConclusion === 'string')) && (value.sizeConclusion === undefined || value.sizeConclusion === null || (typeof value.sizeConclusion === 'string')) && (value.paymentConclusion === undefined || value.paymentConclusion === null || (typeof value.paymentConclusion === 'string')) && (value.priorityReason === undefined || value.priorityReason === null || (typeof value.priorityReason === 'string')) && (value.priceRank === undefined || value.priceRank === null || (typeof value.priceRank === 'number' && Number.isSafeInteger(value.priceRank))); }

export function validShoppingResultV1CandidatesItemsItemShop(value: ShoppingResultV1CandidatesItemsItemShop): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.shopName === undefined || value.shopName === null || (typeof value.shopName === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')); }

export function validShoppingResultV1CandidatesItemsItemDeliveryEtaReference(value: ShoppingResultV1CandidatesItemsItemDeliveryEtaReference): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.shipFrom === undefined || value.shipFrom === null || (typeof value.shipFrom === 'string')) && (value.shipTimeText === undefined || value.shipTimeText === null || (typeof value.shipTimeText === 'string')) && (value.deliveryTimeText === undefined || value.deliveryTimeText === null || (typeof value.deliveryTimeText === 'string')) && (value.deliveryDays === undefined || value.deliveryDays === null || (typeof value.deliveryDays === 'number' && Number.isFinite(value.deliveryDays))) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.returnShippingInsurance === undefined || value.returnShippingInsurance === null || (typeof value.returnShippingInsurance === 'boolean')) && (value.sevenDayNoReasonReturn === undefined || value.sevenDayNoReasonReturn === null || (typeof value.sevenDayNoReasonReturn === 'boolean')) && (value.serviceLabels === undefined || value.serviceLabels === null || (Array.isArray(value.serviceLabels) && value.serviceLabels.every((item: string) => item === null || (typeof item === 'string')))); }

export function validShoppingResultV1CandidatesItemsItem(value: ShoppingResultV1CandidatesItemsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.candidateItemId === null || (typeof value.candidateItemId === 'string')) && (value.snapshotId === undefined || value.snapshotId === null || (typeof value.snapshotId === 'string')) && (value.productId === undefined || value.productId === null || (typeof value.productId === 'string')) && (value.productPoolKey === undefined || value.productPoolKey === null || (typeof value.productPoolKey === 'string')) && (value.externalId === undefined || value.externalId === null || (typeof value.externalId === 'string')) && (value.title === undefined || value.title === null || (typeof value.title === 'string')) && (value.platformName === undefined || value.platformName === null || (typeof value.platformName === 'string')) && (value.currency === undefined || value.currency === null || (typeof value.currency === 'string')) && (value.shopName === undefined || value.shopName === null || (typeof value.shopName === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')) && (value.stockStatus === undefined || value.stockStatus === null || (typeof value.stockStatus === 'string')) && (value.coverImageUrl === undefined || value.coverImageUrl === null || (typeof value.coverImageUrl === 'string')) && (value.productUrl === undefined || value.productUrl === null || (typeof value.productUrl === 'string')) && (value.platformProductId === undefined || value.platformProductId === null || (typeof value.platformProductId === 'string')) && (value.platformBrandId === undefined || value.platformBrandId === null || (typeof value.platformBrandId === 'string')) && (value.createdAt === undefined || value.createdAt === null || (typeof value.createdAt === 'string')) && (value.rank === undefined || value.rank === null || (typeof value.rank === 'number' && Number.isSafeInteger(value.rank))) && (value.pageIndex === undefined || value.pageIndex === null || (typeof value.pageIndex === 'number' && Number.isSafeInteger(value.pageIndex))) && (value.amount === undefined || value.amount === null || ((typeof value.amount === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.amount)) || (typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount >= 0))) && (value.price === undefined || value.price === null || validShoppingResultV1CandidatesItemsItemPrice(value.price as ShoppingResultV1CandidatesItemsItemPrice)) && (value.matchSummary === undefined || value.matchSummary === null || value.matchSummary !== undefined) && (value.normalizedAttributes === undefined || value.normalizedAttributes === null || value.normalizedAttributes !== undefined) && (value.rawPayload === undefined || value.rawPayload === null || value.rawPayload !== undefined) && (value.attributes === undefined || value.attributes === null || value.attributes !== undefined) && (value.matchScore === undefined || value.matchScore === null || (typeof value.matchScore === 'number' && Number.isFinite(value.matchScore))) && (value.recommendationReason === undefined || value.recommendationReason === null || (Array.isArray(value.recommendationReason) && value.recommendationReason.every((item: string) => item === null || (typeof item === 'string')))) && (value.commerceMeta === undefined || value.commerceMeta === null || validShoppingResultV1CandidatesItemsItemCommerceMeta(value.commerceMeta as ShoppingResultV1CandidatesItemsItemCommerceMeta)) && (value.sortSignals === undefined || value.sortSignals === null || validShoppingResultV1CandidatesItemsItemSortSignals(value.sortSignals as ShoppingResultV1CandidatesItemsItemSortSignals)) && (value.decisionTags === undefined || value.decisionTags === null || (Array.isArray(value.decisionTags) && value.decisionTags.every((item: Object) => item === null || item !== undefined))) && (value.decisionSupport === undefined || value.decisionSupport === null || validShoppingResultV1CandidatesItemsItemDecisionSupport(value.decisionSupport as ShoppingResultV1CandidatesItemsItemDecisionSupport)) && (value.shop === undefined || value.shop === null || validShoppingResultV1CandidatesItemsItemShop(value.shop as ShoppingResultV1CandidatesItemsItemShop)) && (value.priceHistoryReference === undefined || value.priceHistoryReference === null || value.priceHistoryReference !== undefined) && (value.deliveryEtaReference === undefined || value.deliveryEtaReference === null || validShoppingResultV1CandidatesItemsItemDeliveryEtaReference(value.deliveryEtaReference as ShoppingResultV1CandidatesItemsItemDeliveryEtaReference)); }

export function validShoppingResultV1CandidatesPageRefsItem(value: ShoppingResultV1CandidatesPageRefsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingResultV1Candidates(value: ShoppingResultV1Candidates): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.snapshotId === undefined || value.snapshotId === null || (typeof value.snapshotId === 'string')) && (value.candidateSnapshotId === undefined || value.candidateSnapshotId === null || (typeof value.candidateSnapshotId === 'string')) && (value.sessionId === undefined || value.sessionId === null || (typeof value.sessionId === 'string')) && (value.createdAt === undefined || value.createdAt === null || (typeof value.createdAt === 'string')) && (value.indexVersion === undefined || value.indexVersion === null || (typeof value.indexVersion === 'string')) && (value.recallMethod === undefined || value.recallMethod === null || (typeof value.recallMethod === 'string')) && (value.turnIndex === undefined || value.turnIndex === null || (typeof value.turnIndex === 'number' && Number.isSafeInteger(value.turnIndex))) && (value.limit === undefined || value.limit === null || (typeof value.limit === 'number' && Number.isSafeInteger(value.limit))) && (value.totalCount === undefined || value.totalCount === null || (typeof value.totalCount === 'number' && Number.isSafeInteger(value.totalCount))) && (value.degraded === undefined || value.degraded === null || (typeof value.degraded === 'boolean')) && (value.appliedFilter === undefined || value.appliedFilter === null || validShoppingResultV1CandidatesAppliedFilter(value.appliedFilter as ShoppingResultV1CandidatesAppliedFilter)) && (value.items === undefined || value.items === null || (Array.isArray(value.items) && value.items.every((item: ShoppingResultV1CandidatesItemsItem) => item === null || validShoppingResultV1CandidatesItemsItem(item as ShoppingResultV1CandidatesItemsItem)))) && (value.pageRefs === undefined || value.pageRefs === null || (Array.isArray(value.pageRefs) && value.pageRefs.every((item: ShoppingResultV1CandidatesPageRefsItem) => item === null || validShoppingResultV1CandidatesPageRefsItem(item as ShoppingResultV1CandidatesPageRefsItem)))) && (value.excludedKeys === undefined || value.excludedKeys === null || (Array.isArray(value.excludedKeys) && value.excludedKeys.every((item: string) => item === null || (typeof item === 'string')))) && (value.requiredInfo === undefined || value.requiredInfo === null || value.requiredInfo !== undefined) && (value.sortOptions === undefined || value.sortOptions === null || value.sortOptions !== undefined) && (value.searchProgress === undefined || value.searchProgress === null || value.searchProgress !== undefined) && (value.fallback === undefined || value.fallback === null || value.fallback !== undefined) && (value.cursor === undefined || value.cursor === null || value.cursor !== undefined); }

export function validShoppingResultV1Profile(value: ShoppingResultV1Profile): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.category === null || (typeof value.category === 'string')) && (value.brand === undefined || value.brand === null || (typeof value.brand === 'string')) && (value.modelLine === undefined || value.modelLine === null || (typeof value.modelLine === 'string')) && (value.colorFamily === undefined || value.colorFamily === null || (typeof value.colorFamily === 'string')) && (value.colorway === undefined || value.colorway === null || (typeof value.colorway === 'string')) && (value.shoeType === undefined || value.shoeType === null || (typeof value.shoeType === 'string')) && (value.size === undefined || value.size === null || (typeof value.size === 'string')) && (value.color === undefined || value.color === null || (typeof value.color === 'string')) && (value.modelVersion === undefined || value.modelVersion === null || (typeof value.modelVersion === 'string')) && (value.profileVersion === undefined || value.profileVersion === null || (typeof value.profileVersion === 'string')) && (value.styleTags === undefined || value.styleTags === null || (Array.isArray(value.styleTags) && value.styleTags.every((item: string) => item === null || (typeof item === 'string')))) && (value.sceneTags === undefined || value.sceneTags === null || (Array.isArray(value.sceneTags) && value.sceneTags.every((item: string) => item === null || (typeof item === 'string')))) && (value.keywords === undefined || value.keywords === null || (Array.isArray(value.keywords) && value.keywords.every((item: string) => item === null || (typeof item === 'string')))) && (value.confidence === undefined || value.confidence === null || (typeof value.confidence === 'number' && Number.isFinite(value.confidence))) && (value.raw === undefined || value.raw === null || value.raw !== undefined); }

export function validShoppingResultV1FiltersPreferences(value: ShoppingResultV1FiltersPreferences): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.shopTypes === undefined || value.shopTypes === null || (Array.isArray(value.shopTypes) && value.shopTypes.every((item: string) => item === null || (typeof item === 'string')))) && (value.brands === undefined || value.brands === null || (Array.isArray(value.brands) && value.brands.every((item: string) => item === null || (typeof item === 'string')))) && (value.colors === undefined || value.colors === null || (Array.isArray(value.colors) && value.colors.every((item: string) => item === null || (typeof item === 'string')))) && (value.platforms === undefined || value.platforms === null || (Array.isArray(value.platforms) && value.platforms.every((item: string) => item === null || (typeof item === 'string')))) && (value.priceDirection === undefined || value.priceDirection === null || (typeof value.priceDirection === 'string')); }

export function validShoppingResultV1Filters(value: ShoppingResultV1Filters): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.priceMin === undefined || value.priceMin === null || ((typeof value.priceMin === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMin)) || (typeof value.priceMin === 'number' && Number.isFinite(value.priceMin) && value.priceMin >= 0))) && (value.priceMax === undefined || value.priceMax === null || ((typeof value.priceMax === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMax)) || (typeof value.priceMax === 'number' && Number.isFinite(value.priceMax) && value.priceMax >= 0))) && (value.priceTarget === undefined || value.priceTarget === null || ((typeof value.priceTarget === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTarget)) || (typeof value.priceTarget === 'number' && Number.isFinite(value.priceTarget) && value.priceTarget >= 0))) && (value.priceTolerance === undefined || value.priceTolerance === null || ((typeof value.priceTolerance === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTolerance)) || (typeof value.priceTolerance === 'number' && Number.isFinite(value.priceTolerance) && value.priceTolerance >= 0))) && (value.timeConstraintDays === undefined || value.timeConstraintDays === null || (typeof value.timeConstraintDays === 'number' && Number.isFinite(value.timeConstraintDays))) && (value.sizeMin === undefined || value.sizeMin === null || (typeof value.sizeMin === 'number' && Number.isFinite(value.sizeMin))) && (value.sizeMax === undefined || value.sizeMax === null || (typeof value.sizeMax === 'number' && Number.isFinite(value.sizeMax))) && (value.stockOnly === undefined || value.stockOnly === null || (typeof value.stockOnly === 'boolean')) && (value.freeShippingOnly === undefined || value.freeShippingOnly === null || (typeof value.freeShippingOnly === 'boolean')) && (value.urgentDeliveryPreferred === undefined || value.urgentDeliveryPreferred === null || (typeof value.urgentDeliveryPreferred === 'boolean')) && (value.sizeSystem === undefined || value.sizeSystem === null || (typeof value.sizeSystem === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')) && (value.categoryScope === undefined || value.categoryScope === null || (typeof value.categoryScope === 'string')) && (value.platformsInclude === undefined || value.platformsInclude === null || (Array.isArray(value.platformsInclude) && value.platformsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.platformsExclude === undefined || value.platformsExclude === null || (Array.isArray(value.platformsExclude) && value.platformsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsInclude === undefined || value.brandsInclude === null || (Array.isArray(value.brandsInclude) && value.brandsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsExclude === undefined || value.brandsExclude === null || (Array.isArray(value.brandsExclude) && value.brandsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsInclude === undefined || value.colorsInclude === null || (Array.isArray(value.colorsInclude) && value.colorsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsExclude === undefined || value.colorsExclude === null || (Array.isArray(value.colorsExclude) && value.colorsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.sizesInclude === undefined || value.sizesInclude === null || (Array.isArray(value.sizesInclude) && value.sizesInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedProductIds === undefined || value.excludedProductIds === null || (Array.isArray(value.excludedProductIds) && value.excludedProductIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedCandidateItemIds === undefined || value.excludedCandidateItemIds === null || (Array.isArray(value.excludedCandidateItemIds) && value.excludedCandidateItemIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.sortRule === undefined || value.sortRule === null || (typeof value.sortRule === 'string' && ["price_asc","price_desc","relevance_desc","rating_desc","delivery_asc"].indexOf(value.sortRule) >= 0)) && (value.preferences === undefined || value.preferences === null || validShoppingResultV1FiltersPreferences(value.preferences as ShoppingResultV1FiltersPreferences)); }

export function validShoppingResultV1AnswerEvidenceRefsItem(value: ShoppingResultV1AnswerEvidenceRefsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingResultV1AnswerProfilePatch(value: ShoppingResultV1AnswerProfilePatch): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.category === null || (typeof value.category === 'string')) && (value.brand === undefined || value.brand === null || (typeof value.brand === 'string')) && (value.modelLine === undefined || value.modelLine === null || (typeof value.modelLine === 'string')) && (value.colorFamily === undefined || value.colorFamily === null || (typeof value.colorFamily === 'string')) && (value.colorway === undefined || value.colorway === null || (typeof value.colorway === 'string')) && (value.shoeType === undefined || value.shoeType === null || (typeof value.shoeType === 'string')) && (value.size === undefined || value.size === null || (typeof value.size === 'string')) && (value.color === undefined || value.color === null || (typeof value.color === 'string')) && (value.modelVersion === undefined || value.modelVersion === null || (typeof value.modelVersion === 'string')) && (value.profileVersion === undefined || value.profileVersion === null || (typeof value.profileVersion === 'string')) && (value.styleTags === undefined || value.styleTags === null || (Array.isArray(value.styleTags) && value.styleTags.every((item: string) => item === null || (typeof item === 'string')))) && (value.sceneTags === undefined || value.sceneTags === null || (Array.isArray(value.sceneTags) && value.sceneTags.every((item: string) => item === null || (typeof item === 'string')))) && (value.keywords === undefined || value.keywords === null || (Array.isArray(value.keywords) && value.keywords.every((item: string) => item === null || (typeof item === 'string')))) && (value.confidence === undefined || value.confidence === null || (typeof value.confidence === 'number' && Number.isFinite(value.confidence))) && (value.raw === undefined || value.raw === null || value.raw !== undefined); }

export function validShoppingResultV1AnswerFilterPatchPreferences(value: ShoppingResultV1AnswerFilterPatchPreferences): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.freeShipping === undefined || value.freeShipping === null || (typeof value.freeShipping === 'boolean')) && (value.shopTypes === undefined || value.shopTypes === null || (Array.isArray(value.shopTypes) && value.shopTypes.every((item: string) => item === null || (typeof item === 'string')))) && (value.brands === undefined || value.brands === null || (Array.isArray(value.brands) && value.brands.every((item: string) => item === null || (typeof item === 'string')))) && (value.colors === undefined || value.colors === null || (Array.isArray(value.colors) && value.colors.every((item: string) => item === null || (typeof item === 'string')))) && (value.platforms === undefined || value.platforms === null || (Array.isArray(value.platforms) && value.platforms.every((item: string) => item === null || (typeof item === 'string')))) && (value.priceDirection === undefined || value.priceDirection === null || (typeof value.priceDirection === 'string')); }

export function validShoppingResultV1AnswerFilterPatch(value: ShoppingResultV1AnswerFilterPatch): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.priceMin === undefined || value.priceMin === null || ((typeof value.priceMin === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMin)) || (typeof value.priceMin === 'number' && Number.isFinite(value.priceMin) && value.priceMin >= 0))) && (value.priceMax === undefined || value.priceMax === null || ((typeof value.priceMax === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceMax)) || (typeof value.priceMax === 'number' && Number.isFinite(value.priceMax) && value.priceMax >= 0))) && (value.priceTarget === undefined || value.priceTarget === null || ((typeof value.priceTarget === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTarget)) || (typeof value.priceTarget === 'number' && Number.isFinite(value.priceTarget) && value.priceTarget >= 0))) && (value.priceTolerance === undefined || value.priceTolerance === null || ((typeof value.priceTolerance === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.priceTolerance)) || (typeof value.priceTolerance === 'number' && Number.isFinite(value.priceTolerance) && value.priceTolerance >= 0))) && (value.timeConstraintDays === undefined || value.timeConstraintDays === null || (typeof value.timeConstraintDays === 'number' && Number.isFinite(value.timeConstraintDays))) && (value.sizeMin === undefined || value.sizeMin === null || (typeof value.sizeMin === 'number' && Number.isFinite(value.sizeMin))) && (value.sizeMax === undefined || value.sizeMax === null || (typeof value.sizeMax === 'number' && Number.isFinite(value.sizeMax))) && (value.stockOnly === undefined || value.stockOnly === null || (typeof value.stockOnly === 'boolean')) && (value.freeShippingOnly === undefined || value.freeShippingOnly === null || (typeof value.freeShippingOnly === 'boolean')) && (value.urgentDeliveryPreferred === undefined || value.urgentDeliveryPreferred === null || (typeof value.urgentDeliveryPreferred === 'boolean')) && (value.sizeSystem === undefined || value.sizeSystem === null || (typeof value.sizeSystem === 'string')) && (value.shopType === undefined || value.shopType === null || (typeof value.shopType === 'string')) && (value.categoryScope === undefined || value.categoryScope === null || (typeof value.categoryScope === 'string')) && (value.platformsInclude === undefined || value.platformsInclude === null || (Array.isArray(value.platformsInclude) && value.platformsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.platformsExclude === undefined || value.platformsExclude === null || (Array.isArray(value.platformsExclude) && value.platformsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsInclude === undefined || value.brandsInclude === null || (Array.isArray(value.brandsInclude) && value.brandsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.brandsExclude === undefined || value.brandsExclude === null || (Array.isArray(value.brandsExclude) && value.brandsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsInclude === undefined || value.colorsInclude === null || (Array.isArray(value.colorsInclude) && value.colorsInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.colorsExclude === undefined || value.colorsExclude === null || (Array.isArray(value.colorsExclude) && value.colorsExclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.sizesInclude === undefined || value.sizesInclude === null || (Array.isArray(value.sizesInclude) && value.sizesInclude.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedProductIds === undefined || value.excludedProductIds === null || (Array.isArray(value.excludedProductIds) && value.excludedProductIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.excludedCandidateItemIds === undefined || value.excludedCandidateItemIds === null || (Array.isArray(value.excludedCandidateItemIds) && value.excludedCandidateItemIds.every((item: string) => item === null || (typeof item === 'string')))) && (value.sortRule === undefined || value.sortRule === null || (typeof value.sortRule === 'string' && ["price_asc","price_desc","relevance_desc","rating_desc","delivery_asc"].indexOf(value.sortRule) >= 0)) && (value.preferences === undefined || value.preferences === null || validShoppingResultV1AnswerFilterPatchPreferences(value.preferences as ShoppingResultV1AnswerFilterPatchPreferences)); }

export function validShoppingResultV1Answer(value: ShoppingResultV1Answer): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.assistantMessage === undefined || value.assistantMessage === null || (typeof value.assistantMessage === 'string')) && (value.intent === undefined || value.intent === null || (typeof value.intent === 'string')) && (value.clarification === undefined || value.clarification === null || (typeof value.clarification === 'string')) && (value.source === undefined || value.source === null || (typeof value.source === 'string')) && (value.conversationSummary === undefined || value.conversationSummary === null || (typeof value.conversationSummary === 'string')) && (value.evidenceRefs === undefined || value.evidenceRefs === null || (Array.isArray(value.evidenceRefs) && value.evidenceRefs.every((item: ShoppingResultV1AnswerEvidenceRefsItem) => item === null || validShoppingResultV1AnswerEvidenceRefsItem(item as ShoppingResultV1AnswerEvidenceRefsItem)))) && (value.candidateComparisons === undefined || value.candidateComparisons === null || (Array.isArray(value.candidateComparisons) && value.candidateComparisons.every((item: Object) => item === null || item !== undefined))) && (value.rejectedOperations === undefined || value.rejectedOperations === null || (Array.isArray(value.rejectedOperations) && value.rejectedOperations.every((item: Object) => item === null || item !== undefined))) && (value.filterRemove === undefined || value.filterRemove === null || (Array.isArray(value.filterRemove) && value.filterRemove.every((item: Object) => item === null || item !== undefined))) && (value.operations === undefined || value.operations === null || (Array.isArray(value.operations) && value.operations.every((item: Object) => item === null || item !== undefined))) && (value.profilePatch === undefined || value.profilePatch === null || validShoppingResultV1AnswerProfilePatch(value.profilePatch as ShoppingResultV1AnswerProfilePatch)) && (value.filterPatch === undefined || value.filterPatch === null || validShoppingResultV1AnswerFilterPatch(value.filterPatch as ShoppingResultV1AnswerFilterPatch)) && (value.shouldResetPreviousFilters === undefined || value.shouldResetPreviousFilters === null || (typeof value.shouldResetPreviousFilters === 'boolean')) && (value.degraded === undefined || value.degraded === null || (typeof value.degraded === 'boolean')) && (value.turnIndex === undefined || value.turnIndex === null || (typeof value.turnIndex === 'number' && Number.isSafeInteger(value.turnIndex))); }

export function validShoppingResultV1PricesItem(value: ShoppingResultV1PricesItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.productId === undefined || value.productId === null || (typeof value.productId === 'string')) && (value.candidateItemId === undefined || value.candidateItemId === null || (typeof value.candidateItemId === 'string')) && (value.currency === undefined || value.currency === null || (typeof value.currency === 'string')) && (value.stockStatus === undefined || value.stockStatus === null || (typeof value.stockStatus === 'string')) && (value.source === undefined || value.source === null || (typeof value.source === 'string')) && (value.sourceObservedAt === undefined || value.sourceObservedAt === null || (typeof value.sourceObservedAt === 'string')) && (value.catalogUpdatedAt === undefined || value.catalogUpdatedAt === null || (typeof value.catalogUpdatedAt === 'string')) && (value.fetchedAt === undefined || value.fetchedAt === null || (typeof value.fetchedAt === 'string')) && (value.freshness === undefined || value.freshness === null || (typeof value.freshness === 'string')) && (value.status === undefined || value.status === null || (typeof value.status === 'string')) && (value.reason === undefined || value.reason === null || (typeof value.reason === 'string')) && (value.amount === undefined || value.amount === null || ((typeof value.amount === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value.amount)) || (typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount >= 0))); }

export function validShoppingResultV1EvidenceRefsItem(value: ShoppingResultV1EvidenceRefsItem): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.artifactId === null || (typeof value.artifactId === 'string')) && (value.contentHash === null || (typeof value.contentHash === 'string' && new RegExp("^[a-f0-9]{64}$").test(value.contentHash))) && (value.schemaId === null || (typeof value.schemaId === 'string')) && (value.contentVersion === null || (typeof value.contentVersion === 'number' && Number.isSafeInteger(value.contentVersion))) && (value.schemaVersion === null || (typeof value.schemaVersion === 'number' && Number.isSafeInteger(value.schemaVersion))); }

export function validShoppingResultV1(value: ShoppingResultV1): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && (value.traceId === undefined || value.traceId === null || (typeof value.traceId === 'string')) && (value.workflowId === undefined || value.workflowId === null || (typeof value.workflowId === 'string')) && (value.taskId === undefined || value.taskId === null || (typeof value.taskId === 'string')) && (value.runId === undefined || value.runId === null || (typeof value.runId === 'string')) && (value.runtimeRunId === undefined || value.runtimeRunId === null || (typeof value.runtimeRunId === 'string')) && (value.attemptId === undefined || value.attemptId === null || (typeof value.attemptId === 'string')) && (value.status === null || (typeof value.status === 'string')) && (value.resultRef === undefined || value.resultRef === null || (typeof value.resultRef === 'string')) && (value.operation === undefined || value.operation === null || (typeof value.operation === 'string')) && (value.sessionId === undefined || value.sessionId === null || (typeof value.sessionId === 'string')) && (value.stateVersion === undefined || value.stateVersion === null || (typeof value.stateVersion === 'number' && Number.isSafeInteger(value.stateVersion))) && (value.requestRevision === undefined || value.requestRevision === null || (typeof value.requestRevision === 'number' && Number.isSafeInteger(value.requestRevision))) && (value.session === undefined || value.session === null || validShoppingResultV1Session(value.session as ShoppingResultV1Session)) && (value.candidates === undefined || value.candidates === null || validShoppingResultV1Candidates(value.candidates as ShoppingResultV1Candidates)) && (value.profile === undefined || value.profile === null || validShoppingResultV1Profile(value.profile as ShoppingResultV1Profile)) && (value.filters === undefined || value.filters === null || validShoppingResultV1Filters(value.filters as ShoppingResultV1Filters)) && (value.answer === undefined || value.answer === null || validShoppingResultV1Answer(value.answer as ShoppingResultV1Answer)) && (value.assistantMessage === undefined || value.assistantMessage === null || ((typeof value.assistantMessage === 'string') || value.assistantMessage !== undefined)) && (value.prices === undefined || value.prices === null || (Array.isArray(value.prices) && value.prices.every((item: ShoppingResultV1PricesItem) => item === null || validShoppingResultV1PricesItem(item as ShoppingResultV1PricesItem)))) && (value.priceSource === undefined || value.priceSource === null || (typeof value.priceSource === 'string')) && (value.pagination === undefined || value.pagination === null || validShoppingPaginationV1(value.pagination as ShoppingPaginationV1)) && (value.fallback === undefined || value.fallback === null || value.fallback !== undefined) && (value.degraded === undefined || value.degraded === null || (typeof value.degraded === 'boolean')) && (value.errors === undefined || value.errors === null || (Array.isArray(value.errors) && value.errors.every((item: Object) => item === null || item !== undefined))) && (value.timing === undefined || value.timing === null || value.timing !== undefined) && (value.serverTiming === undefined || value.serverTiming === null || value.serverTiming !== undefined) && (value.evidenceRefs === undefined || value.evidenceRefs === null || (Array.isArray(value.evidenceRefs) && value.evidenceRefs.every((item: ShoppingResultV1EvidenceRefsItem) => item === null || validShoppingResultV1EvidenceRefsItem(item as ShoppingResultV1EvidenceRefsItem)))) && (value.imageSearch === undefined || value.imageSearch === null || value.imageSearch !== undefined); }
