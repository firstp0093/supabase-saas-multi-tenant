// supabase/functions/create-checkout/index.ts
// Creates a Stripe Checkout session for subscriptions or one-time payments

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
  
  // Determine which Stripe key to use
  const authHeader = req.headers.get('Authorization')!
  const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''))
  
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const { tenant_id, price_id, mode, success_url, cancel_url } = await req.json()
  
  // Get tenant's Stripe customer ID
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('stripe_customer_id')
    .eq('id', tenant_id)
    .single()
  
  if (!tenant?.stripe_customer_id) {
    return new Response(JSON.stringify({ error: 'Tenant has no Stripe customer' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Use live keys for production
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
  
  const session = await stripe.checkout.sessions.create({
    customer: tenant.stripe_customer_id,
    mode: mode || 'subscription',
    line_items: [{ price: price_id, quantity: 1 }],
    success_url,
    cancel_url,
    metadata: { tenant_id, user_id: user.id }
  })
  
  return new Response(JSON.stringify({ url: session.url }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
