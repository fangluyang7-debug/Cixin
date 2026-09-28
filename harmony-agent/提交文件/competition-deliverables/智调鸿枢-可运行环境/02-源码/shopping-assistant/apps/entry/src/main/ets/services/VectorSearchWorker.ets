/**
 * Computes cosine scores for one independent product-vector partition.
 *
 * Product vectors use row-wise int8 quantization. The query vector is already
 * normalized. A background index task can precompute truncated-vector norms;
 * if no cached norms are supplied, the worker computes them inline.
 */
@Concurrent
export function scoreQuantizedVectorChunk(
  queryVector: number[],
  quantizedVectors: ArrayBuffer,
  vectorScales: number[],
  precomputedNorms: number[],
  fullDimension: number,
  activeDimension: number,
  productCount: number
): number[] {
  const bytes: Uint8Array = new Uint8Array(quantizedVectors);
  const scores: number[] = [];
  let queryNormSquared: number = 0;
  for (let dimensionIndex: number = 0; dimensionIndex < activeDimension; dimensionIndex++) {
    queryNormSquared += queryVector[dimensionIndex] * queryVector[dimensionIndex];
  }
  const queryNorm: number = Math.sqrt(queryNormSquared);
  for (let productIndex: number = 0; productIndex < productCount; productIndex++) {
    const scale: number = vectorScales[productIndex];
    const rowOffset: number = productIndex * fullDimension;
    let dotProduct: number = 0;
    let productNormSquared: number = 0;
    for (let dimensionIndex: number = 0; dimensionIndex < activeDimension; dimensionIndex++) {
      const rawByte: number = bytes[rowOffset + dimensionIndex];
      const signedValue: number = rawByte > 127 ? rawByte - 256 : rawByte;
      const productValue: number = signedValue * scale;
      dotProduct += queryVector[dimensionIndex] * productValue;
      if (precomputedNorms.length !== productCount) {
        productNormSquared += productValue * productValue;
      }
    }
    const productNorm: number = precomputedNorms.length === productCount ?
      precomputedNorms[productIndex] :
      Math.sqrt(productNormSquared);
    const denominator: number = queryNorm * productNorm;
    const cosine: number = denominator > 0 ? dotProduct / denominator : 0;
    scores.push(Math.max(-1, Math.min(1, cosine)));
  }
  return scores;
}

/**
 * Rebuilds one partition of the dimension-specific vector-norm cache.
 * This is the real workload behind background_index_update.
 */
@Concurrent
export function computeQuantizedNormChunk(
  quantizedVectors: ArrayBuffer,
  vectorScales: number[],
  fullDimension: number,
  activeDimension: number,
  productCount: number
): number[] {
  const bytes: Uint8Array = new Uint8Array(quantizedVectors);
  const norms: number[] = [];
  for (let productIndex: number = 0; productIndex < productCount; productIndex++) {
    const scale: number = vectorScales[productIndex];
    const rowOffset: number = productIndex * fullDimension;
    let normSquared: number = 0;
    for (let dimensionIndex: number = 0; dimensionIndex < activeDimension; dimensionIndex++) {
      const rawByte: number = bytes[rowOffset + dimensionIndex];
      const signedValue: number = rawByte > 127 ? rawByte - 256 : rawByte;
      const productValue: number = signedValue * scale;
      normSquared += productValue * productValue;
    }
    norms.push(Math.sqrt(normSquared));
  }
  return norms;
}
