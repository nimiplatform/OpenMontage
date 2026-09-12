"""Adapter from Nimi-held checkpoint documents to the existing checkpoint writer."""
from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any
from jsonschema import ValidationError

from lib.checkpoint import init_project, validate_checkpoint, write_checkpoint
from lib.pipeline_loader import get_stage_order, list_pipelines, load_pipeline_readonly


def checkpoint(request: dict[str, Any]) -> dict[str, Any]:
    root = Path(request["project_dir"]).resolve()
    project_id = request.get("projectId", "")
    if not root.is_dir() or not re.fullmatch(r"[A-Za-z0-9-]{8,80}", project_id):
        raise ValueError("A valid project and temporary directory are required")
    pipeline = request.get("pipelineId")
    if pipeline not in list_pipelines() or pipeline == "framework-smoke":
        raise ValueError("The pipeline is not part of this App")
    stages = get_stage_order(load_pipeline_readonly(pipeline))
    stage = request.get("stage")
    if stage not in stages:
        raise ValueError("The stage is not part of this App pipeline")
    project = init_project(project_id, title=request["title"], pipeline_type=pipeline, pipeline_dir=root)
    for name, previous in request.get("checkpoints", {}).items():
        if name not in stages or previous.get("project_id") != project_id or previous.get("pipeline_type") != pipeline:
            raise ValueError("Checkpoint identity does not match this project")
        validate_checkpoint(previous)
        (project / f"checkpoint_{name}.json").write_text(json.dumps(previous), encoding="utf-8")
    try:
        output = write_checkpoint(
            root, project_id, stage, request["status"], request.get("artifacts", {}),
            pipeline_type=pipeline, human_approved=request.get("humanApproved") is True,
            metadata=request.get("metadata"), error=request.get("error"),
        )
    except ValueError as error:
        if isinstance(error.__cause__, ValidationError):
            cause = error.__cause__
            artifact = str(error).split(" failed schema validation:", 1)[0]
            location = "/" + "/".join(str(part) for part in cause.absolute_path)
            raise ValueError(f"{artifact} failed schema validation at {location}: {cause.message}") from error
        raise
    return {"checkpoint": json.loads(output.read_text(encoding="utf-8"))}
