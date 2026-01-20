// supabase/functions/stripe-webhook/index.ts
// Handles Stripe webhook events to update tenant plans

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14"

serve(async (req) => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const signature = req.headers.get('stripe-signature')!
  const body = await req.text()
  
  let event: Stripe.Event
  
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 400 })
  }
  
  console.log('Received event:', event.type)
  
  // Handle subscription events
  if (event.type === 'customer.subscription.updated' || 
      event.type === 'customer.subscription.created') {
    const subscription = event.data.object as Stripe.Subscription
    
    // Get the price to determine plan tier
    const priceId = subscription.items.data[0]?.price.id
    
    // You can map price IDs to plan tiers
    // Or use product metadata
    let plan = 'starter'
    
    if (subscription.status === 'active') {
      // Fetch product to get plan tier from metadata
      const price = await stripe.prices.retrieve(priceId)
      const product = await stripe.products.retrieve(price.product as string)
      plan = (product.metadata?.plan_tier as string) || 'starter'
    }
    
    // Update tenant plan
    const { error } = await supabaseAdmin
      .from('tenants')
      .update({ plan, updated_at: new Date().toISOString() })
      .eq('stripe_customer_id', subscription.customer)
    
    if (error) {
      console.error('Failed to update tenant plan:', error)
    } else {
      console.log(`Updated tenant plan to ${plan} for customer ${subscription.customer}`)
    }
  }
  
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription
    
    // Downgrade to free
    await supabaseAdmin
      .from('tenants')
      .update({ plan: 'free', updated_at: new Date().toISOString() })
      .eq('stripe_customer_id', subscription.customer)
    
    console.log(`Downgraded tenant to free for customer ${subscription.customer}`)
  }
  
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice
    
    // You could send a notification, update a status, etc.
    console.log(`Payment failed for customer ${invoice.customer}`)
    
    // Optional: Update tenant with payment_failed status
    await supabaseAdmin
      .from('tenants')
      .update({ 
        settings: { payment_failed: true, failed_at: new Date().toISOString() }
      })
      .eq('stripe_customer_id', invoice.customer)
  }
  
  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
