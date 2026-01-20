// =====================================================
// MANAGE BILLING
// Subscription & one-time payments via Stripe
// For AI-driven billing operations
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
}

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const ADMIN_KEY = Deno.env.get('ADMIN_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const authHeader = req.headers.get('Authorization')
  const adminKey = req.headers.get('X-Admin-Key')
  const isAdmin = adminKey === ADMIN_KEY

  let user: any = null
  let tenant: any = null
  let membership: any = null

  // Auth for non-admin requests
  if (!isAdmin && authHeader) {
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (!authError && authUser) {
      user = authUser
      const { data: m } = await supabase
        .from('tenant_users')
        .select('tenant_id, tenants(id, stripe_customer_id, stripe_subscription_id, plan)')
        .eq('user_id', user.id)
        .single()
      membership = m
      tenant = m?.tenants
    }
  }

  const body = await req.json()
  const { action } = body

  const stripeHeaders = {
    'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  }

  // =====================================================
  // ONE-TIME PRODUCTS (Admin)
  // =====================================================

  // ===== CREATE PRODUCT =====
  if (action === 'create_product') {
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin key required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { name, description, price, currency, metadata, images } = body

    if (!name || !price) {
      return new Response(JSON.stringify({ error: 'name and price required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      // Create product in Stripe
      const productParams = new URLSearchParams({
        'name': name,
        'description': description || '',
      })
      if (images?.length) {
        images.forEach((img: string, i: number) => {
          productParams.append(`images[${i}]`, img)
        })
      }
      if (metadata) {
        Object.entries(metadata).forEach(([k, v]) => {
          productParams.append(`metadata[${k}]`, String(v))
        })
      }

      const productResponse = await fetch('https://api.stripe.com/v1/products', {
        method: 'POST',
        headers: stripeHeaders,
        body: productParams
      })
      const product = await productResponse.json()

      if (product.error) {
        return new Response(JSON.stringify({ error: product.error.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Create price for product
      const priceParams = new URLSearchParams({
        'unit_amount': String(Math.round(price * 100)),
        'currency': currency || 'usd',
        'product': product.id
      })

      const priceResponse = await fetch('https://api.stripe.com/v1/prices', {
        method: 'POST',
        headers: stripeHeaders,
        body: priceParams
      })
      const stripePrice = await priceResponse.json()

      // Store in database
      const { data: dbProduct, error: dbError } = await supabase
        .from('products')
        .insert({
          stripe_product_id: product.id,
          stripe_price_id: stripePrice.id,
          name,
          description,
          price,
          currency: currency || 'usd',
          metadata,
          active: true,
          type: 'one_time'
        })
        .select()
        .single()

      return new Response(JSON.stringify({
        success: true,
        product: {
          id: dbProduct?.id,
          stripe_product_id: product.id,
          stripe_price_id: stripePrice.id,
          name,
          price,
          currency: currency || 'usd'
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

  // ===== LIST PRODUCTS =====
  if (action === 'list_products') {
    try {
      const { data: products, error } = await supabase
        .from('products')
        .select('*')
        .eq('active', true)
        .eq('type', 'one_time')
        .order('created_at', { ascending: false })

      if (error) throw error

      return new Response(JSON.stringify({ products }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== UPDATE PRODUCT =====
  if (action === 'update_product') {
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin key required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { product_id, name, description, active, metadata } = body

    if (!product_id) {
      return new Response(JSON.stringify({ error: 'product_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      // Get product from DB
      const { data: dbProduct } = await supabase
        .from('products')
        .select('stripe_product_id')
        .eq('id', product_id)
        .single()

      if (!dbProduct) {
        return new Response(JSON.stringify({ error: 'Product not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Update in Stripe
      const updateParams = new URLSearchParams()
      if (name) updateParams.append('name', name)
      if (description !== undefined) updateParams.append('description', description)
      if (active !== undefined) updateParams.append('active', String(active))
      if (metadata) {
        Object.entries(metadata).forEach(([k, v]) => {
          updateParams.append(`metadata[${k}]`, String(v))
        })
      }

      await fetch(`https://api.stripe.com/v1/products/${dbProduct.stripe_product_id}`, {
        method: 'POST',
        headers: stripeHeaders,
        body: updateParams
      })

      // Update in database
      const updates: any = {}
      if (name) updates.name = name
      if (description !== undefined) updates.description = description
      if (active !== undefined) updates.active = active
      if (metadata) updates.metadata = metadata

      const { data: updated } = await supabase
        .from('products')
        .update(updates)
        .eq('id', product_id)
        .select()
        .single()

      return new Response(JSON.stringify({ success: true, product: updated }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== DELETE/ARCHIVE PRODUCT =====
  if (action === 'archive_product') {
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin key required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { product_id } = body

    if (!product_id) {
      return new Response(JSON.stringify({ error: 'product_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const { data: dbProduct } = await supabase
        .from('products')
        .select('stripe_product_id')
        .eq('id', product_id)
        .single()

      if (dbProduct) {
        // Archive in Stripe
        await fetch(`https://api.stripe.com/v1/products/${dbProduct.stripe_product_id}`, {
          method: 'POST',
          headers: stripeHeaders,
          body: new URLSearchParams({ 'active': 'false' })
        })
      }

      // Soft delete in database
      await supabase
        .from('products')
        .update({ active: false })
        .eq('id', product_id)

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // =====================================================
  // PURCHASE ONE-TIME PRODUCT (User)
  // =====================================================

  // ===== CREATE CHECKOUT SESSION =====
  if (action === 'purchase_product') {
    if (!user) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { product_id, success_url, cancel_url, quantity } = body

    if (!product_id) {
      return new Response(JSON.stringify({ error: 'product_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      // Get product
      const { data: product } = await supabase
        .from('products')
        .select('*')
        .eq('id', product_id)
        .eq('active', true)
        .single()

      if (!product) {
        return new Response(JSON.stringify({ error: 'Product not found or inactive' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Ensure customer exists
      let customerId = tenant?.stripe_customer_id
      if (!customerId) {
        const customerResponse = await fetch('https://api.stripe.com/v1/customers', {
          method: 'POST',
          headers: stripeHeaders,
          body: new URLSearchParams({
            'email': user.email,
            'metadata[user_id]': user.id,
            'metadata[tenant_id]': membership?.tenant_id || ''
          })
        })
        const customer = await customerResponse.json()
        customerId = customer.id

        // Store customer ID
        if (membership?.tenant_id) {
          await supabase
            .from('tenants')
            .update({ stripe_customer_id: customerId })
            .eq('id', membership.tenant_id)
        }
      }

      // Create checkout session
      const checkoutParams = new URLSearchParams({
        'mode': 'payment',
        'customer': customerId,
        'line_items[0][price]': product.stripe_price_id,
        'line_items[0][quantity]': String(quantity || 1),
        'success_url': success_url || `${SUPABASE_URL}/purchase-success?session_id={CHECKOUT_SESSION_ID}`,
        'cancel_url': cancel_url || `${SUPABASE_URL}/purchase-cancelled`,
        'metadata[product_id]': product_id,
        'metadata[user_id]': user.id,
        'metadata[tenant_id]': membership?.tenant_id || ''
      })

      const sessionResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: stripeHeaders,
        body: checkoutParams
      })
      const session = await sessionResponse.json()

      if (session.error) {
        return new Response(JSON.stringify({ error: session.error.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({
        checkout_url: session.url,
        session_id: session.id
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== GET PURCHASES =====
  if (action === 'get_purchases') {
    if (!user && !isAdmin) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { tenant_id: queryTenantId } = body

    try {
      let query = supabase
        .from('purchases')
        .select(`
          *,
          products(name, description, price, currency)
        `)
        .order('created_at', { ascending: false })

      if (isAdmin && queryTenantId) {
        query = query.eq('tenant_id', queryTenantId)
      } else if (membership?.tenant_id) {
        query = query.eq('tenant_id', membership.tenant_id)
      } else if (user) {
        query = query.eq('user_id', user.id)
      }

      const { data: purchases, error } = await query

      if (error) throw error

      return new Response(JSON.stringify({ purchases }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== VERIFY PURCHASE =====
  if (action === 'verify_purchase') {
    const { session_id } = body

    if (!session_id) {
      return new Response(JSON.stringify({ error: 'session_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const response = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${session_id}`,
        { headers: stripeHeaders }
      )
      const session = await response.json()

      if (session.payment_status === 'paid') {
        // Record purchase if not already recorded
        const { data: existing } = await supabase
          .from('purchases')
          .select('id')
          .eq('stripe_session_id', session_id)
          .single()

        if (!existing) {
          await supabase
            .from('purchases')
            .insert({
              stripe_session_id: session_id,
              stripe_payment_intent: session.payment_intent,
              product_id: session.metadata.product_id,
              user_id: session.metadata.user_id,
              tenant_id: session.metadata.tenant_id || null,
              amount: session.amount_total / 100,
              currency: session.currency,
              status: 'completed'
            })
        }

        return new Response(JSON.stringify({
          verified: true,
          status: 'completed',
          product_id: session.metadata.product_id
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({
        verified: false,
        status: session.payment_status
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // =====================================================
  // SUBSCRIPTIONS (Existing)
  // =====================================================

  // User auth required for subscription actions
  if (!user && ['get_status', 'change_plan', 'cancel', 'reactivate', 'update_payment_method', 'get_invoices'].includes(action)) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== GET SUBSCRIPTION STATUS =====
  if (action === 'get_status') {
    if (!tenant?.stripe_subscription_id) {
      return new Response(JSON.stringify({
        plan: tenant?.plan || 'free',
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
        items: subscription.items?.data?.map((item: any) => ({
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
    const { plan } = body

    if (!plan) {
      return new Response(JSON.stringify({ error: 'plan required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

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
      if (!tenant?.stripe_subscription_id) {
        return new Response(JSON.stringify({ error: 'No active subscription' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

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
    if (!tenant?.stripe_subscription_id) {
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
          body: new URLSearchParams({ 'cancel_at_period_end': 'true' })
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
    if (!tenant?.stripe_subscription_id) {
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
          body: new URLSearchParams({ 'cancel_at_period_end': 'false' })
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
    const { payment_method_id } = body

    if (!payment_method_id) {
      return new Response(JSON.stringify({ error: 'payment_method_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      await fetch(
        `https://api.stripe.com/v1/payment_methods/${payment_method_id}/attach`,
        {
          method: 'POST',
          headers: stripeHeaders,
          body: new URLSearchParams({ 'customer': tenant.stripe_customer_id })
        }
      )

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
    if (!tenant?.stripe_customer_id) {
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
        invoices: invoices?.map((inv: any) => ({
          id: inv.id,
          number: inv.number,
          amount: inv.amount_paid / 100,
          currency: inv.currency,
          status: inv.status,
          created: new Date(inv.created * 1000),
          pdf_url: inv.invoice_pdf
        })) || []
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
    available_actions: {
      subscriptions: ['get_status', 'change_plan', 'cancel', 'reactivate', 'update_payment_method', 'get_invoices'],
      products_admin: ['create_product', 'update_product', 'archive_product'],
      products_user: ['list_products', 'purchase_product', 'get_purchases', 'verify_purchase']
    }
  }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
