// Dependencies describe the actual operation, not every capability on the host.
export const SHOPPING_DEPENDENCIES: Record<string, string[]> = {
  'shopping.read': ['database'], 'shopping.prices': ['database'], 'shopping.answer': ['database'],
  'shopping.text': ['database', 'chat', 'embedding', 'catalogText'],
  'shopping.image': ['database', 'cos', 'vision', 'embedding', 'catalog'],
  'shopping.image_upload': ['database', 'cos', 'vision', 'embedding', 'catalog'],
  'shopping.debug': ['database', 'cos', 'vision', 'embedding', 'catalog'],
  'shopping.subject': ['database', 'cos', 'vision', 'embedding', 'catalog'],
  'shopping.profile': ['database', 'chat', 'embedding', 'catalog'],
  'shopping.refine': ['database', 'cos', 'vision', 'embedding', 'catalog'],
  'shopping.stage.receive': ['database'], 'shopping.stage.asset': ['database', 'cos'],
  'shopping.stage.quality-check': ['cos'], 'shopping.stage.crop': ['cos'],
  'shopping.stage.category': ['vision'], 'shopping.stage.product-profile': ['vision'],
  'shopping.stage.embedding': ['embedding'], 'shopping.stage.vector-search': ['database', 'catalog'],
  'shopping.stage.price-stock': ['database'], 'shopping.stage.rank': ['database'],
  'shopping.stage.answer': ['database'], 'shopping.stage.result': ['database'],
};
