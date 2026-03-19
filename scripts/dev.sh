#!/usr/bin/env bash
set -euo pipefail

uv run uvicorn subtracker_api.main:app --reload

