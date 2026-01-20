-- =====================================================
-- PRODUCTS AND PURCHASES
-- One-time product sales via Stripe
-- =====================================================

-- Products table (for one-time purchases)
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_product_id TEXT UNIQUE,
  stripe_price_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'usd',
  type TEXT DEFAULT 'one_time', -- 'one_time' or 'subscription'
  metadata JSONB DEFAULT '{}'::jsonb,
  images TEXT[] DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Purchases table (completed one-time purchases)
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  product_id UUID REFERENCES products(id),
  user_id UUID REFERENCES auth.users(id),
  tenant_id UUID REFERENCES tenants(id),
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'usd',
  quantity INTEGER DEFAULT 1,
  status TEXT DEFAULT 'completed', -- 'pending', 'completed', 'refunded', 'failed'
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_tenant ON purchases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);

-- Enable RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

-- Products policies (public read, admin write)
CREATE POLICY "Products are viewable by everyone" ON products
  FOR SELECT USING (active = true);

CREATE POLICY "Products are editable by admins" ON products
  FOR ALL USING (false); -- Admin access via service role

-- Purchases policies (users see their own)
CREATE POLICY "Users can view their own purchases" ON purchases
  FOR SELECT USING (
    auth.uid() = user_id OR
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Purchases created by service" ON purchases
  FOR INSERT WITH CHECK (false); -- Service role only

-- Updated_at trigger for products
CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_products_updated_at();

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Check if user has purchased a product
CREATE OR REPLACE FUNCTION has_purchased(p_product_id UUID, p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM purchases
    WHERE product_id = p_product_id
    AND user_id = COALESCE(p_user_id, auth.uid())
    AND status = 'completed'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get user's purchased product IDs
CREATE OR REPLACE FUNCTION get_purchased_products(p_user_id UUID DEFAULT NULL)
RETURNS SETOF UUID AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT product_id
  FROM purchases
  WHERE user_id = COALESCE(p_user_id, auth.uid())
  AND status = 'completed';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- SAMPLE PRODUCTS (optional)
-- =====================================================

-- Uncomment to add sample products
/*
INSERT INTO products (name, description, price, currency, type, metadata) VALUES
('Starter Template', 'Landing page template for startups', 49.00, 'usd', 'one_time', '{"category": "templates"}'),
('Pro Template Bundle', '10 premium templates', 149.00, 'usd', 'one_time', '{"category": "templates"}'),
('Custom Integration', 'One-time setup fee for custom integrations', 299.00, 'usd', 'one_time', '{"category": "services"}'),
('Training Session', '1-hour training session', 199.00, 'usd', 'one_time', '{"category": "services"}');
*/
