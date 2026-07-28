ALTER TABLE public.product_scans
  ADD COLUMN IF NOT EXISTS input_type text,
  ADD COLUMN IF NOT EXISTS product_match_confidence numeric,
  ADD COLUMN IF NOT EXISTS data_completeness_score numeric,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS product_observations_scan_field_idx
  ON public.product_observations(scan_id, field_name);