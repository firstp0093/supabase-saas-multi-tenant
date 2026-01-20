// =====================================================
// MANAGE STRIPE CONNECT
// Enables tenants to collect payments from their users
// Create accounts, onboarding, payment links, payouts
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
}

const ADMIN_KEY = Deno.env.get('ADMIN_KEY')!
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const PLATFORM_URL = Deno.env.get('PLATFORM_URL') || 'https://yourplatform.com'

const stripeHeaders = {
  'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
  'Content-Type': 'application/x-www-form-urlencoded'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (!STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const authHeader = req.headers.get('Authorization')
  const adminKey = req.headers.get('X-Admin-Key')
  const isAdmin = adminKey === ADMIN_KEY

  // Get authenticated user
  let user: any = null
  let membership: any = null

  if (authHeader) {
    const { data: { user: authUser } } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authUser) {
      user = authUser
      const { data: m } = await supabase
        .from('user_tenants')
        .select('tenant_id, role')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .single()
      membership = m
    }
  }

  if (!isAdmin && (!membership || !['owner', 'admin'].includes(membership.role))) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const body = await req.json()
  const { action, sub_saas_id } = body
  const tenantId = isAdmin ? body.tenant_id : membership?.tenant_id

  // Helper to verify sub-saas access
  async function verifyAccess(subSaasId: string): Promise<any> {
    const { data } = await supabase
      .from('sub_saas_apps')
      .select('*, stripe_connect_accounts(*)')
      .eq('id', subSaasId)
      .single()

    if (!data) return null
    if (isAdmin) return data
    if (data.tenant_id === tenantId) return data
    return null
  }

  // ===== CREATE CONNECTED ACCOUNT =====
  if (action === 'create_account') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app) {
      return new Response(JSON.stringify({ error: 'Not found or access denied' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (app.stripe_account_id) {
      return new Response(JSON.stringify({ 
        error: 'Stripe Connect already set up',
        account_id: app.stripe_account_id
      }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const { account_type = 'express', country = 'US' } = body

      // Create connected account
      const accountResponse = await fetch('https://api.stripe.com/v1/accounts', {
        method: 'POST',
        headers: stripeHeaders,
        body: new URLSearchParams({
          'type': account_type,
          'country': country,
          'capabilities[card_payments][requested]': 'true',
          'capabilities[transfers][requested]': 'true',
          'metadata[sub_saas_id]': sub_saas_id,
          'metadata[tenant_id]': app.tenant_id
        })
      })
      
      const account = await accountResponse.json()

      if (account.error) {
        throw new Error(account.error.message)
      }

      // Save to database
      await supabase
        .from('stripe_connect_accounts')
        .insert({
          sub_saas_id,
          tenant_id: app.tenant_id,
          stripe_account_id: account.id,
          account_type,
          country,
          default_currency: account.default_currency || 'usd'
        })

      // Update sub-saas app
      await supabase
        .from('sub_saas_apps')
        .update({ 
          stripe_connect_enabled: true,
          stripe_account_id: account.id 
        })
        .eq('id', sub_saas_id)

      return new Response(JSON.stringify({
        success: true,
        account: {
          id: account.id,
          type: account_type,
          country: country
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== GET ONBOARDING LINK =====
  if (action === 'get_onboarding_link') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app || !app.stripe_account_id) {
      return new Response(JSON.stringify({ error: 'Stripe Connect not set up' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { return_url, refresh_url } = body

    try {
      const linkResponse = await fetch('https://api.stripe.com/v1/account_links', {
        method: 'POST',
        headers: stripeHeaders,
        body: new URLSearchParams({
          'account': app.stripe_account_id,
          'type': 'account_onboarding',
          'return_url': return_url || `${PLATFORM_URL}/connect/return`,
          'refresh_url': refresh_url || `${PLATFORM_URL}/connect/refresh`
        })
      })
      
      const link = await linkResponse.json()

      if (link.error) {
        throw new Error(link.error.message)
      }

      return new Response(JSON.stringify({
        url: link.url,
        expires_at: link.expires_at
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== GET DASHBOARD LINK =====
  if (action === 'get_dashboard_link') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app || !app.stripe_account_id) {
      return new Response(JSON.stringify({ error: 'Stripe Connect not set up' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const loginResponse = await fetch('https://api.stripe.com/v1/accounts/' + app.stripe_account_id + '/login_links', {
        method: 'POST',
        headers: stripeHeaders
      })
      
      const login = await loginResponse.json()

      if (login.error) {
        throw new Error(login.error.message)
      }

      return new Response(JSON.stringify({ url: login.url }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== CREATE PAYMENT LINK =====
  if (action === 'create_payment_link') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { amount, currency = 'usd', description, metadata = {} } = body

    if (!amount) {
      return new Response(JSON.stringify({ error: 'amount required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app || !app.stripe_account_id) {
      return new Response(JSON.stringify({ error: 'Stripe Connect not set up' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      // Get platform fee from settings
      const platformFeePercent = app.stripe_connect_accounts?.platform_fee_percent || 0
      const platformFee = Math.round(amount * (platformFeePercent / 100))

      // Create a product first
      const productParams = new URLSearchParams({
        'name': description || 'Payment'
      })

      const productResponse = await fetch('https://api.stripe.com/v1/products', {
        method: 'POST',
        headers: {
          ...stripeHeaders,
          'Stripe-Account': app.stripe_account_id
        },
        body: productParams
      })
      const product = await productResponse.json()

      // Create a price
      const priceParams = new URLSearchParams({
        'unit_amount': String(Math.round(amount * 100)),
        'currency': currency,
        'product': product.id
      })

      const priceResponse = await fetch('https://api.stripe.com/v1/prices', {
        method: 'POST',
        headers: {
          ...stripeHeaders,
          'Stripe-Account': app.stripe_account_id
        },
        body: priceParams
      })
      const price = await priceResponse.json()

      // Create payment link
      const linkParams = new URLSearchParams({
        'line_items[0][price]': price.id,
        'line_items[0][quantity]': '1'
      })

      // Add platform fee if configured
      if (platformFee > 0) {
        linkParams.append('application_fee_amount', String(platformFee))
      }

      Object.entries(metadata).forEach(([k, v]) => {
        linkParams.append(`metadata[${k}]`, String(v))
      })

      const paymentLinkResponse = await fetch('https://api.stripe.com/v1/payment_links', {
        method: 'POST',
        headers: {
          ...stripeHeaders,
          'Stripe-Account': app.stripe_account_id
        },
        body: linkParams
      })
      
      const paymentLink = await paymentLinkResponse.json()

      if (paymentLink.error) {
        throw new Error(paymentLink.error.message)
      }

      return new Response(JSON.stringify({
        payment_link: {
          id: paymentLink.id,
          url: paymentLink.url,
          amount: amount,
          currency: currency,
          platform_fee: platformFee / 100
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== LIST PAYMENTS =====
  if (action === 'list_payments') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app || !app.stripe_account_id) {
      return new Response(JSON.stringify({ error: 'Stripe Connect not set up' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { limit = 10 } = body

    try {
      const chargesResponse = await fetch(
        `https://api.stripe.com/v1/charges?limit=${limit}`,
        {
          headers: {
            ...stripeHeaders,
            'Stripe-Account': app.stripe_account_id
          }
        }
      )
      
      const charges = await chargesResponse.json()

      if (charges.error) {
        throw new Error(charges.error.message)
      }

      return new Response(JSON.stringify({
        payments: charges.data.map((charge: any) => ({
          id: charge.id,
          amount: charge.amount / 100,
          currency: charge.currency,
          status: charge.status,
          description: charge.description,
          customer_email: charge.billing_details?.email,
          created: new Date(charge.created * 1000)
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

  // ===== GET BALANCE =====
  if (action === 'get_balance') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app || !app.stripe_account_id) {
      return new Response(JSON.stringify({ error: 'Stripe Connect not set up' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const balanceResponse = await fetch('https://api.stripe.com/v1/balance', {
        headers: {
          ...stripeHeaders,
          'Stripe-Account': app.stripe_account_id
        }
      })
      
      const balance = await balanceResponse.json()

      if (balance.error) {
        throw new Error(balance.error.message)
      }

      return new Response(JSON.stringify({
        balance: {
          available: balance.available.map((b: any) => ({
            amount: b.amount / 100,
            currency: b.currency
          })),
          pending: balance.pending.map((b: any) => ({
            amount: b.amount / 100,
            currency: b.currency
          }))
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== GET ACCOUNT STATUS =====
  if (action === 'get_status') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app || !app.stripe_account_id) {
      return new Response(JSON.stringify({ error: 'Stripe Connect not set up' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const accountResponse = await fetch(
        `https://api.stripe.com/v1/accounts/${app.stripe_account_id}`,
        { headers: stripeHeaders }
      )
      
      const account = await accountResponse.json()

      if (account.error) {
        throw new Error(account.error.message)
      }

      // Update local database with current status
      await supabase
        .from('stripe_connect_accounts')
        .update({
          details_submitted: account.details_submitted,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          business_name: account.business_profile?.name
        })
        .eq('stripe_account_id', app.stripe_account_id)

      // Update onboarding status
      if (account.details_submitted) {
        await supabase
          .from('sub_saas_apps')
          .update({ stripe_onboarding_complete: true })
          .eq('id', sub_saas_id)
      }

      return new Response(JSON.stringify({
        status: {
          account_id: account.id,
          details_submitted: account.details_submitted,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          business_name: account.business_profile?.name,
          country: account.country,
          default_currency: account.default_currency,
          requirements: account.requirements
        }
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
    error: 'Invalid action',
    available_actions: [
      'create_account',
      'get_onboarding_link',
      'get_dashboard_link',
      'create_payment_link',
      'list_payments',
      'get_balance',
      'get_status'
    ]
  }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
