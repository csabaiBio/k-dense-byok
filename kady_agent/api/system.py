from __future__ import annotations

import os
from collections.abc import Iterable

import httpx
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/config")
async def config():
    """Expose non-secret feature flags to the frontend."""
    modal_id = os.environ.get("MODAL_TOKEN_ID", "").strip()
    modal_secret = os.environ.get("MODAL_TOKEN_SECRET", "").strip()
    return {
        "modal_configured": bool(modal_id and modal_secret),
    }


def _format_ollama_bytes(n: int) -> str:
    """Compact GB/MB rendering for Ollama blob sizes."""
    if not isinstance(n, (int, float)) or n <= 0:
        return ""
    gb = n / 1_073_741_824
    if gb >= 1:
        return f"{gb:.1f} GB"
    mb = n / 1_048_576
    return f"{mb:.0f} MB"


def _ollama_entry(tag: dict) -> dict:
    """Map an `/api/tags` entry to the Model shape consumed by the UI."""
    name = tag.get("name") or tag.get("model") or ""
    details = tag.get("details") or {}
    family = details.get("family") or ""
    param_size = details.get("parameter_size") or ""
    quant = details.get("quantization_level") or ""
    size_str = _format_ollama_bytes(int(tag.get("size") or 0))

    bits = [b for b in (family, param_size, quant, size_str) if b]
    description = (
        "Local model served by Ollama at OLLAMA_BASE_URL. "
        + (" · ".join(bits) if bits else "")
    ).strip()

    return {
        "id": f"ollama/{name}" if name else "ollama/unknown",
        "label": name or "unknown",
        "provider": "Ollama",
        "tier": "budget",
        "context_length": 0,
        "pricing": {"prompt": 0.0, "completion": 0.0},
        "modality": "text->text",
        "description": description,
    }


def _parse_csv_values(raw: str | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    for part in raw.split(","):
        value = part.strip()
        if value:
            out.append(value)
    return out


def _normalize_deployments(values: Iterable[str]) -> list[str]:
    """Deduplicate deployment IDs while preserving user order."""
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _azure_entry(prefix: str, deployment: str) -> dict:
    """Map an Azure deployment id to the UI's Model shape."""
    provider = "Azure AI" if prefix == "azure_ai" else "Azure OpenAI"
    return {
        "id": f"{prefix}/{deployment}",
        "label": deployment,
        "provider": provider,
        "tier": "high",
        "context_length": 0,
        "pricing": {"prompt": 0.0, "completion": 0.0},
        "modality": "text+image+file->text",
        "description": (
            "Azure-hosted deployment configured via environment variables. "
            "Pricing is managed in your Azure subscription."
        ),
    }


@router.get("/ollama/models")
async def list_ollama_models():
    """Proxy to Ollama and map tags into the UI's Model shape."""
    base = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{base}/api/tags")
        resp.raise_for_status()
    except Exception:
        return {"available": False, "models": []}
    try:
        data = resp.json() or {}
    except ValueError:
        return {"available": False, "models": []}
    tags = data.get("models") or []
    entries = [_ollama_entry(t) for t in tags if isinstance(t, dict)]
    return {"available": True, "models": entries}


@router.get("/azure/models")
async def list_azure_models():
    """Return Azure deployments configured for LiteLLM wildcard routing."""
    azure_openai = _normalize_deployments(
        _parse_csv_values(os.environ.get("AZURE_OPENAI_DEPLOYMENTS"))
    )
    azure_ai = _normalize_deployments(
        _parse_csv_values(os.environ.get("AZURE_AI_DEPLOYMENTS"))
    )

    models = [
        *[_azure_entry("azure", deployment) for deployment in azure_openai],
        *[_azure_entry("azure_ai", deployment) for deployment in azure_ai],
    ]

    has_openai_config = bool(
        os.environ.get("AZURE_OPENAI_API_BASE", "").strip()
        and os.environ.get("AZURE_OPENAI_API_KEY", "").strip()
    )
    has_ai_config = bool(
        os.environ.get("AZURE_AI_API_BASE", "").strip()
        and os.environ.get("AZURE_AI_API_KEY", "").strip()
    )

    return {
        "available": bool(models),
        "configured": {
            "azure_openai": has_openai_config,
            "azure_ai": has_ai_config,
        },
        "models": models,
    }
