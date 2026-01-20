// supabase/functions/provision-tenant/index.ts
// Creates a new tenant with Stripe customer

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  // Use test or live key based on environment
  const isTest = Deno.env.get('USE_TEST_STRIPE') === 'true'
  const stripeKey = isTest 
    ? Deno.env.get('STRIPE_TEST_SECRET_KEY')!
    : Deno.env.get('STRIPE_LIVE_SECRET_KEY')!
  const stripe = new Stripe(stripeKey)
  
  // Get user from JWT
  const authHeader = req.headers.get('Authorization')!
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const { tenant_name, slug } = await req.json()
  
  // 1. Create Stripe customer
  const stripeCustomer = await stripe.customers.create({
    email: user.email,
    name: tenant_name,
    metadata: { 
      tenant_slug: slug,
      supabase_user_id: user.id 
    }
  })
  
  // 2. Create tenant record
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .insert({
      name: tenant_name,
      slug: slug,
      stripe_customer_id: stripeCustomer.id,
      plan: 'free'
    })
    .select()
    .single()
  
  if (tenantError) {
    // Rollback Stripe customer
    await stripe.customers.del(stripeCustomer.id)
    return new Response(JSON.stringify({ error: tenantError.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // 3. Link user as owner
  await supabaseAdmin.from('user_tenants').insert({
    user_id: user.id,
    tenant_id: tenant.id,
    role: 'owner',
    is_default: true
  })
  
  return new Response(JSON.stringify({ 
    tenant,
    stripe_customer_id: stripeCustomer.id 
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
