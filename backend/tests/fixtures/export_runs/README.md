Frozen golden inputs for `backend/tests/test_export_normalization.py`.

- These JSONL files are synthetic-case fixtures only: `case-001`, `case-002`, and `case-003`.
- They are copied from `data/runs/` so the export-normalization tests do not depend on whatever other runs happen to exist in the repo later.
- Do not edit these files by hand.

If the export-normalization contract changes in the future, regenerate this fixture set by copying the canonical synthetic run JSONLs from `data/runs/` into this directory, then update the assertions in `backend/tests/test_export_normalization.py` to match the new contract.
