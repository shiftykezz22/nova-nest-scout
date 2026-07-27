
-- update_updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile upsert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- new user trigger
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.calculation_settings (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- product_scans
CREATE TABLE public.product_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_session_id TEXT,
  input_url TEXT NOT NULL,
  normalized_url TEXT,
  walmart_item_id TEXT,
  title TEXT,
  brand TEXT,
  upc_gtin TEXT,
  product_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  analysis_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_scans TO authenticated;
GRANT ALL ON public.product_scans TO service_role;
ALTER TABLE public.product_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scans" ON public.product_scans FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER product_scans_updated BEFORE UPDATE ON public.product_scans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- supplier_results
CREATE TABLE public.supplier_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_scan_id UUID NOT NULL REFERENCES public.product_scans(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  supplier_url TEXT,
  supplier_type TEXT,
  location TEXT,
  country TEXT,
  product_match TEXT,
  unit_cost NUMERIC,
  currency TEXT DEFAULT 'USD',
  moq INTEGER,
  case_pack INTEGER,
  estimated_shipping NUMERIC,
  estimated_landed_cost NUMERIC,
  lead_time_days INTEGER,
  sample_available BOOLEAN,
  private_label_available BOOLEAN,
  authorization_status TEXT,
  verification_status TEXT,
  contact_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_results TO authenticated;
GRANT ALL ON public.supplier_results TO service_role;
ALTER TABLE public.supplier_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own suppliers" ON public.supplier_results FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.product_scans s WHERE s.id = product_scan_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.product_scans s WHERE s.id = product_scan_id AND s.user_id = auth.uid()));
CREATE TRIGGER supplier_results_updated BEFORE UPDATE ON public.supplier_results FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- saved_products
CREATE TABLE public.saved_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_scan_id UUID NOT NULL REFERENCES public.product_scans(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, product_scan_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_products TO authenticated;
GRANT ALL ON public.saved_products TO service_role;
ALTER TABLE public.saved_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own saved" ON public.saved_products FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- calculation_settings
CREATE TABLE public.calculation_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_fee_percent NUMERIC NOT NULL DEFAULT 15,
  fulfillment_fee NUMERIC NOT NULL DEFAULT 5.50,
  storage_cost NUMERIC NOT NULL DEFAULT 0.50,
  inbound_shipping_per_unit NUMERIC NOT NULL DEFAULT 1.00,
  prep_cost_per_unit NUMERIC NOT NULL DEFAULT 0.75,
  duties_per_unit NUMERIC NOT NULL DEFAULT 0,
  advertising_percent NUMERIC NOT NULL DEFAULT 5,
  return_allowance_percent NUMERIC NOT NULL DEFAULT 2,
  desired_profit NUMERIC NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calculation_settings TO authenticated;
GRANT ALL ON public.calculation_settings TO service_role;
ALTER TABLE public.calculation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own calc" ON public.calculation_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER calc_settings_updated BEFORE UPDATE ON public.calculation_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- new user trigger installation
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
