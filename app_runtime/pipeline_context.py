"""Read the original pipeline contracts for the Nimi-hosted production UI."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from lib.pipeline_loader import list_pipelines, load_pipeline_readonly

ROOT = Path(__file__).resolve().parent.parent


def pipeline_context(request: dict[str, Any]) -> dict[str, Any]:
    names = sorted(name for name in list_pipelines() if name != "framework-smoke")
    selected = request.get("pipelineId")
    if not selected:
        return {"context": {"type": "catalog", "pipelines": [summary(name) for name in names]}}
    if selected not in names:
        raise ValueError("The selected pipeline is not shipped with OpenMontage.")
    manifest = load_pipeline_readonly(selected)
    stage = next((item for item in manifest["stages"] if item["name"] == request.get("stage")), None)
    if stage is None:
        raise ValueError("The selected stage is not part of this pipeline.")
    skill = ROOT / "skills" / (stage["skill"] + ".md")
    schemas = {}
    for artifact in stage.get("produces", []):
        path = ROOT / "schemas" / "artifacts" / (artifact + ".schema.json")
        if not path.is_file():
            raise ValueError(f"The artifact schema is missing: {artifact}")
        schemas[artifact] = json.loads(path.read_text(encoding="utf-8"))
    return {"context": {"type": "stage", "pipeline": summary(selected), "stage": stage_summary(stage), "instructions": skill.read_text(encoding="utf-8"), "schemas": schemas}}


def stage_summary(stage: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": stage["name"], "gated": bool(stage.get("human_approval_default")),
        "produces": stage.get("produces", []), "requires": stage.get("required_artifacts_in", []),
        "tools": stage.get("tools_available", []), "requiredTools": stage.get("required_tools", []),
    }


def summary(name: str) -> dict[str, Any]:
    manifest = load_pipeline_readonly(name)
    return {"id": name, "description": manifest["description"].strip(), "stability": manifest.get("stability", ""), "stages": [stage_summary(stage) for stage in manifest["stages"]]}
