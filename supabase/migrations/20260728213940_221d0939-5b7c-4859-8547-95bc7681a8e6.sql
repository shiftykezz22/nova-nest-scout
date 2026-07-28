CREATE TABLE public.product_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.product_scans(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  raw_value text,
  normalized_value text,
  source_name text NOT NULL,
  source_url text,
  verification_status text NOT NULL,
  confidence numeric NOT NULL DEFAULT 0,
  is_selected_value boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_observations TO authenticated;
GRANT ALL ON public.product_observations TO service_role;
ALTER TABLE public.product_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own observations" ON public.product_observations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.product_scans s WHERE s.id = scan_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.product_scans s WHERE s.id = scan_id AND s.user_id = auth.uid()));
CREATE INDEX product_observations_scan_id_idx ON public.product_observations(scan_id);
CREATE INDEX product_observations_field_idx ON public.product_observations(scan_id, field_name);

CREATE TABLE public.scan_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.product_scans(id) ON DELETE CASCADE,
  provider_name text NOT NULL,
  request_type text NOT NULL,
  request_status text NOT NULL,
  source_url text,
  records_returned integer,
  latency_ms integer,
  error_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_sources TO authenticated;
GRANT ALL ON public.scan_sources TO service_role;
ALTER TABLE public.scan_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scan sources" ON public.scan_sources FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.product_scans s WHERE s.id = scan_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.product_scans s WHERE s.id = scan_id AND s.user_id = auth.uid()));
CREATE INDEX scan_sources_scan_id_idx ON public.scan_sources(scan_id);