export class UpdateProductProfileDto {
  filters?: Record<string, unknown>;
  category?: string;
  brand?: string | null;
  modelLine?: string | null;
  colorFamily?: string | null;
  colorway?: string | null;
  shoeType?: string | null;
  size?: string | null;
  color?: string | null;
  styleTags?: string[];
  sceneTags?: string[];
  keywords?: string[];
  confidence?: number;
}
