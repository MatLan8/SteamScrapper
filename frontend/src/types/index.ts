export type ScraperMode = "single" | "multi";
export type ScraperMethod = "endpoint" | "browser";

export type JobStatus = "running" | "completed" | "failed";

export type ProgressSnapshot = {
  totalSkins: number;
  completedSkins: number;
  skippedSkins: number;
  failedSkins: number;
  currentSkin: {
    marketHashName?: string;
    workerIndex?: number;
    skinIndex?: number;
    totalSkins?: number;
    currentPage?: number;
    totalPages?: number;
    currentRequest?: number;
    totalRequests?: number;
    listingsCollected?: number;
  } | null;
};

export type ProgressEvent = {
  type: string;
  jobId?: string;
  workerIndex?: number;
  skinIndex?: number;
  totalSkins?: number;
  marketHashName?: string;
  status?: string;
  reason?: string | null;
  currentPage?: number;
  totalPages?: number;
  listingsCollected?: number;
  currentRequest?: number;
  totalRequests?: number;
  results?: unknown;
  error?: string;
};

export type JobSnapshot = {
  id: string;
  type: string;
  status: JobStatus;
  args: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
  progress: ProgressSnapshot;
  results: unknown;
  error: string | null;
};

export type FloatListingRow = {
  listingId: string;
  priceText: string;
  priceCents?: number;
  floatValue: number;
  inspectLink?: string;
  page?: number;
};

export type FloatMultiSkinResult = {
  marketHashName: string;
  skinName: string;
  skipped?: boolean;
  topResults: FloatListingRow[];
};

export type FloatMultiResults = {
  summary: Record<string, unknown>;
  skinResults: FloatMultiSkinResult[];
  skippedSkins?: Array<{
    marketHashName: string;
    totalCount?: number;
    reason?: string;
  }>;
  failedSkins?: Array<{ marketHashName: string; error: string }>;
};

export type FloatSingleResults = {
  summary: { marketHashName?: string; url?: string; mode?: string };
  topResults: Array<{
    floatValue: number;
    priceText: string | null;
    listingId: string;
    inspectLink?: string | null;
    page?: number;
    globalListingIndex?: number;
    start?: number;
  }>;
};

export type FieldType = "text" | "number" | "select" | "checkbox" | "textarea";

export type FieldOption = { value: string; label: string };

export type FieldConfig = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: FieldOption[];
  defaultValue?: string | number | boolean;
};
