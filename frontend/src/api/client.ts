import axios from "axios";

const API_BASE = "https://riskflow-api-1odp.onrender.com";

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
