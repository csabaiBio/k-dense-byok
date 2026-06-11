"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/projects";

export interface AppConfig {
  modalConfigured: boolean;
  defaultAgentModelId: string | null;
  defaultExpertModelId: string | null;
}

const DEFAULT_CONFIG: AppConfig = {
  modalConfigured: false,
  defaultAgentModelId: null,
  defaultExpertModelId: null,
};

export function useConfig(): AppConfig {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setConfig({
            modalConfigured: !!data.modal_configured,
            defaultAgentModelId:
              typeof data.default_agent_model === "string"
                ? data.default_agent_model
                : null,
            defaultExpertModelId:
              typeof data.default_expert_model === "string"
                ? data.default_expert_model
                : null,
          });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return config;
}
