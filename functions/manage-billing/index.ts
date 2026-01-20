// =====================================================
// MANAGE BILLING
// Subscription & payment management via Stripe
// For AI-driven billing operations
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const authHeader = req.headers.get('Authorization')!
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  )

  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const { action, plan, subscription_id, payment_method_id } = await req.json()

  // Get user's tenant
  const { data: membership } = await supabase
    .from('tenant_users')
    .select('tenant_id, tenants(stripe_customer_id, stripe_subscription_id, plan)')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return new Response(JSON.stringify({ error: 'No tenant found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const tenant = membership.tenants as any
  const stripeHeaders = {
    'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  }

  // ===== GET SUBSCRIPTION STATUS =====
  if (action === 'get_status') {
    if (!tenant.stripe_subscription_id) {
      return new Response(JSON.stringify({
        plan: tenant.plan || 'free',
        status: 'inactive',
        current_period_end: null
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const response = await fetch(
        `https://api.stripe.com/v1/subscriptions/${tenant.stripe_subscription_id}`,
        { headers: stripeHeaders }
      )
      const subscription = await response.json()

      return new Response(JSON.stringify({
        plan: tenant.plan,
        status: subscription.status,
        current_period_end: new Date(subscription.current_period_end * 1000),
        cancel_at_period_end: subscription.cancel_at_period_end,
        items: subscription.items.data.map((item: any) => ({
          price_id: item.price.id,
          quantity: item.quantity
        }))
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== CHANGE PLAN =====
  if (action === 'change_plan') {
    if (!plan) {
      return new Response(JSON.stringify({ error: 'plan required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get price ID for plan
    const priceIds: Record<string, string> = {
      starter: Deno.env.get('STRIPE_PRICE_STARTER')!,
      pro: Deno.env.get('STRIPE_PRICE_PRO')!,
      enterprise: Deno.env.get('STRIPE_PRICE_ENTERPRISE')!
    }

    if (!priceIds[plan]) {
      return new Response(JSON.stringify({ error: 'Invalid plan' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      if (!tenant.stripe_subscription_id) {
        return new Response(JSON.stringify({ error: 'No active subscription' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Update subscription
      const subResponse = await fetch(
        `https://api.stripe.com/v1/subscriptions/${tenant.stripe_subscription_id}`,
        { headers: stripeHeaders }
      )
      const currentSub = await subResponse.json()

      const updateResponse = await fetch(
        `https://api.stripe.com/v1/subscriptions/${tenant.stripe_subscription_id}`,
        {
          method: 'POST',
          headers: stripeHeaders,
          body: new URLSearchParams({
            'items[0][id]': currentSub.items.data[0].id,
            'items[0][price]': priceIds[plan],
            'proration_behavior': 'always_invoice'
          })
        }
      )

      const updatedSub = await updateResponse.json()

      // Update database
      await supabase
        .from('tenants')
        .update({ plan })
        .eq('id', membership.tenant_id)

      return new Response(JSON.stringify({
        success: true,
        plan,
        subscription: updatedSub
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== CANCEL SUBSCRIPTION =====
  if (action === 'cancel') {
    if (!tenant.stripe_subscription_id) {
      return new Response(JSON.stringify({ error: 'No active subscription' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const response = await fetch(
        `https://api.stripe.com/v1/subscriptions/${tenant.stripe_subscription_id}`,
        {
          method: 'POST',
          headers: stripeHeaders,
          body: new URLSearchParams({
            'cancel_at_period_end': 'true'
          })
        }
      )

      const subscription = await response.json()

      return new Response(JSON.stringify({
        success: true,
        cancelled_at_period_end: true,
        period_end: new Date(subscription.current_period_end * 1000)
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== REACTIVATE SUBSCRIPTION =====
  if (action === 'reactivate') {
    if (!tenant.stripe_subscription_id) {
      return new Response(JSON.stringify({ error: 'No subscription to reactivate' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const response = await fetch(
        `https://api.stripe.com/v1/subscriptions/${tenant.stripe_subscription_id}`,
        {
          method: 'POST',
          headers: stripeHeaders,
          body: new URLSearchParams({
            'cancel_at_period_end': 'false'
          })
        }
      )

      const subscription = await response.json()

      return new Response(JSON.stringify({
        success: true,
        status: subscription.status
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== UPDATE PAYMENT METHOD =====
  if (action === 'update_payment_method') {
    if (!payment_method_id) {
      return new Response(JSON.stringify({ error: 'payment_method_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      // Attach payment method to customer
      await fetch(
        `https://api.stripe.com/v1/payment_methods/${payment_method_id}/attach`,
        {
          method: 'POST',
          headers: stripeHeaders,
          body: new URLSearchParams({
            'customer': tenant.stripe_customer_id
          })
        }
      )

      // Set as default
      await fetch(
        `https://api.stripe.com/v1/customers/${tenant.stripe_customer_id}`,
        {
          method: 'POST',
          headers: stripeHeaders,
          body: new URLSearchParams({
            'invoice_settings[default_payment_method]': payment_method_id
          })
        }
      )

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== GET INVOICES =====
  if (action === 'get_invoices') {
    if (!tenant.stripe_customer_id) {
      return new Response(JSON.stringify({ invoices: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const response = await fetch(
        `https://api.stripe.com/v1/invoices?customer=${tenant.stripe_customer_id}&limit=10`,
        { headers: stripeHeaders }
      )
      const { data: invoices } = await response.json()

      return new Response(JSON.stringify({
        invoices: invoices.map((inv: any) => ({
          id: inv.id,
          number: inv.number,
          amount: inv.amount_paid / 100,
          currency: inv.currency,
          status: inv.status,
          created: new Date(inv.created * 1000),
          pdf_url: inv.invoice_pdf
        }))
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  return new Response(JSON.stringify({
    error: 'Invalid action. Use: get_status, change_plan, cancel, reactivate, update_payment_method, get_invoices'
  }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
