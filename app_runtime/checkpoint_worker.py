"""Adapter from Nimi-held checkpoint documents to the existing checkpoint writer."""
from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any

from lib.checkpoint import init_project, validate_checkpoint, write_checkpoint
from lib.pipeline_loader import get_stage_order, load_pipeline_readonly

PIPELINE = "nimi-image-explainer"


def checkpoint(request: dict[str, Any]) -> dict[str, Any]:
    root = Path(request["project_dir"]).resolve()
    project_id = request.get("projectId", "")
    if not root.is_dir() or not re.fullmatch(r"[A-Za-z0-9-]{8,80}", project_id):
        raise ValueError("A valid project and temporary directory are required")
    stages = get_stage_order(load_pipeline_readonly(PIPELINE))
    stage = request.get("stage")
    if stage not in stages:
        raise ValueError("The stage is not part of this App pipeline")
    project = init_project(project_id, title=request["title"], pipeline_type=PIPELINE, pipeline_dir=root)
    for name, previous in request.get("checkpoints", {}).items():
        if name not in stages or previous.get("project_id") != project_id or previous.get("pipeline_type") != PIPELINE:
            raise ValueError("Checkpoint identity does not match this project")
        validate_checkpoint(previous)
        (project / f"checkpoint_{name}.json").write_text(json.dumps(previous), encoding="utf-8")
    output = write_checkpoint(
        root, project_id, stage, request["status"], request.get("artifacts", {}),
        pipeline_type=PIPELINE, human_approved=request.get("humanApproved") is True,
        metadata=request.get("metadata"), error=request.get("error"),
    )
    return {"checkpoint": json.loads(output.read_text(encoding="utf-8"))}
