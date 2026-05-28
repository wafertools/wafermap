export interface DieMetadata {
  lotId?: string;
  waferId?: string;
  deviceType?: string;
  testProgram?: string;
  temperature?: number;
  [key: string]: unknown;
}

export interface WaferMetadata {
  lot?:         string;
  waferId?:     string | number;
  product?:     string;
  testDate?:    string;
  operator?:    string;
  testProgram?: string;
  temperature?: number;
  [key: string]: unknown;
}
