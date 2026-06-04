"use client";

import { useCallback, useEffect, useState } from "react";

import staticModels from "@/data/models.json";
import type { Model } from "@/components/model-selector";
import { apiFetch, onProjectChange } from "@/lib/projects";

const OPENROUTER_MODELS = staticModels as Model[];

interface OllamaListResponse {
  available?: boolean;
  models?: Model[];
}

interface AzureListResponse {
  available?: boolean;
  models?: Model[];
}

export interface UseModelsReturn {
  /** Every model available to the user: static OpenRouter catalogue + Azure + live Ollama tags. */
  models: Model[];
  /** Azure deployments configured in env and routed via LiteLLM wildcards. */
  azureModels: Model[];
  /** Just the Ollama-sourced entries, in the order returned by the backend. */
  ollamaModels: Model[];
  /** True when the backend was able to reach `OLLAMA_BASE_URL/api/tags`. */
  ollamaAvailable: boolean;
  /** Re-fetch the Ollama list. */
  refresh: () => void;
}

/**
 * Merge the static OpenRouter-derived `models.json` with Azure deployments
 * configured in env and whatever models are currently pulled in the user's
 * local Ollama server.
 *
 * Ollama discovery is best-effort: if the daemon is offline we silently
 * fall back to OpenRouter-only. The hook re-fetches on project change to
 * keep the list fresh when the user returns after pulling a new model.
 */
export function useModels(): UseModelsReturn {
  const [azureModels, setAzureModels] = useState<Model[]>([]);
  const [ollamaModels, setOllamaModels] = useState<Model[]>([]);
  const [ollamaAvailable, setOllamaAvailable] = useState(false);

  const fetchAzure = useCallback(() => {
    apiFetch("/azure/models")
      .then((r) => (r.ok ? (r.json() as Promise<AzureListResponse>) : null))
      .then((data) => {
        if (!data) return;
        setAzureModels(Array.isArray(data.models) ? data.models : []);
      })
      .catch(() => {
        setAzureModels([]);
      });
  }, []);

  const fetchOllama = useCallback(() => {
    apiFetch("/ollama/models")
      .then((r) => (r.ok ? (r.json() as Promise<OllamaListResponse>) : null))
      .then((data) => {
        if (!data) return;
        setOllamaAvailable(Boolean(data.available));
        setOllamaModels(Array.isArray(data.models) ? data.models : []);
      })
      .catch(() => {
        setOllamaAvailable(false);
        setOllamaModels([]);
      });
  }, []);

  useEffect(() => {
    fetchAzure();
    fetchOllama();
  }, [fetchAzure, fetchOllama]);

  useEffect(
    () => onProjectChange(() => {
      fetchAzure();
      fetchOllama();
    }),
    [fetchAzure, fetchOllama]
  );

  return {
    models: [...OPENROUTER_MODELS, ...azureModels, ...ollamaModels],
    azureModels,
    ollamaModels,
    ollamaAvailable,
    refresh: () => {
      fetchAzure();
      fetchOllama();
    },
  };
}
