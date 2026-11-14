import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "https://riskflow-api-1odp.onrender.com";

// The API runs on a free tier that spins down when idle; a cold start can take
// up to a minute. Retry with backoff instead of failing on the first attempt.
const api = axios.create({ baseURL: API_BASE, timeout: 20000 });

async function getWithRetry<T = any>(url: string, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await api.get(url);
      return res.data as T;
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
    }
  }
  throw lastError;
}

export const getCostAnalysis = () => getWithRetry("/api/cost-analysis");

export const getThresholdSimulation = (threshold: number) =>
  getWithRetry(`/api/threshold-simulator?threshold=${threshold}`);

export const getPipelineHealth = () => getWithRetry("/api/pipeline/health");

export const getSensitivityAnalysis = () => getWithRetry("/api/sensitivity-analysis");

export const API_URL = API_BASE;

export type AnalyzeInputs = {
  file?: File | null;
  useSample?: boolean;
  customerValue: number;
  churnRate: number;
  chargebackFee: number;
  currentThreshold?: number | null;
  mapping?: Record<string, string> | null;
};

// Thrown when the file is readable but its columns could not be identified.
// The UI uses it to ask the person to match their columns.
export class NeedsMapping extends Error {
  columns: string[];
  matched: Record<string, string>;
  suggestion: Record<string, string> | null;
  suggestedBy: string | null;
  constructor(body: any) {
    super(body.detail);
    this.columns = body.columns;
    this.matched = body.matched || {};
    this.suggestion = body.suggestion || null;
    this.suggestedBy = body.suggested_by || null;
  }
}

// Analysis can arrive while the API is cold, so allow a longer timeout and one retry
// for network failures (but never retry a 4xx: that is a problem with the request).
export async function analyzeOrders(inputs: AnalyzeInputs) {
  const form = new FormData();
  if (inputs.useSample) form.append("use_sample", "true");
  if (inputs.file) form.append("file", inputs.file);
  form.append("customer_value", String(inputs.customerValue));
  form.append("churn_rate", String(inputs.churnRate));
  form.append("chargeback_fee", String(inputs.chargebackFee));
  if (inputs.currentThreshold != null) form.append("current_threshold", String(inputs.currentThreshold));
  if (inputs.mapping) form.append("mapping", JSON.stringify(inputs.mapping));

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await api.post("/api/analyze", form, { timeout: 70000 });
      return res.data;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 422 && err.response.data?.needs_mapping) throw new NeedsMapping(err.response.data);
      if (status && status < 500) {
        throw new Error(err.response.data?.detail || "The file could not be analyzed.");
      }
      if (attempt >= 1) throw new Error("The analysis service did not respond. It may be waking up, so try again in a minute.");
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}
