// supabase/functions/setup-page/index.ts
// Returns injectable HTML snippets for auth, Stripe, and Google Ads

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SetupRequest {
  page_id: string
  environment: 'test' | 'production'
  features: {
    auth: boolean
    stripe: boolean
    gads_matching: boolean
  }
  gads_config?: {
    campaign_id?: string
    keywords?: Record<string, Record<string, string>>
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const authHeader = req.headers.get('Authorization')!
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const { page_id, environment, features, gads_config }: SetupRequest = await req.json()
  
  // Get tenant for this user
  const { data: userTenant } = await supabase
    .from('user_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()
  
  const tenant_id = userTenant?.tenant_id
  
  if (!tenant_id) {
    return new Response(JSON.stringify({ error: 'No tenant found' }), { 
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const isTest = environment === 'test'
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  
  const stripePublishableKey = isTest 
    ? Deno.env.get('STRIPE_TEST_PUBLISHABLE_KEY')!
    : Deno.env.get('STRIPE_LIVE_PUBLISHABLE_KEY')!

  const snippets: Record<string, string> = {}
  
  // HEAD SNIPPET
  snippets.head = `
<!-- Supabase SaaS Setup - ${environment.toUpperCase()} -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
${features.stripe ? '<script src="https://js.stripe.com/v3/"></script>' : ''}
<script>
  window.__SAAS_CONFIG__ = {
    supabaseUrl: "${supabaseUrl}",
    supabaseKey: "${supabaseAnonKey}",
    tenantId: "${tenant_id}",
    pageId: "${page_id}",
    environment: "${environment}",
    ${features.stripe ? `stripeKey: "${stripePublishableKey}",` : ''}
    ${features.gads_matching ? `gadsEndpoint: "${supabaseUrl}/functions/v1/gads-message-match",` : ''}
  };
</script>
`.trim()

  // AUTH SNIPPET
  if (features.auth) {
    snippets.auth_init = `
<script>
  const supabase = window.supabase.createClient(
    window.__SAAS_CONFIG__.supabaseUrl,
    window.__SAAS_CONFIG__.supabaseKey
  );
  
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      document.body.classList.add('authenticated');
      document.body.classList.remove('anonymous');
      window.__SAAS_USER__ = session.user;
    } else {
      document.body.classList.remove('authenticated');
      document.body.classList.add('anonymous');
      window.__SAAS_USER__ = null;
    }
    document.dispatchEvent(new CustomEvent('saas:auth', { detail: { event, session }}));
  });
  
  window.saasAuth = {
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password) => supabase.auth.signUp({ email, password }),
    signOut: () => supabase.auth.signOut(),
    getUser: () => supabase.auth.getUser(),
    google: () => supabase.auth.signInWithOAuth({ provider: 'google' }),
  };
</script>
<style>
  .authenticated .show-anonymous { display: none !important; }
  .anonymous .show-authenticated { display: none !important; }
</style>
`.trim()

    snippets.auth_form = `
<div id="saas-auth-container">
  <div class="show-anonymous">
    <form id="saas-login-form">
      <input type="email" id="saas-email" placeholder="Email" required>
      <input type="password" id="saas-password" placeholder="Password" required>
      <button type="submit">Sign In</button>
      <button type="button" onclick="saasAuth.google()">Continue with Google</button>
    </form>
  </div>
  <div class="show-authenticated">
    <span id="saas-user-email"></span>
    <button onclick="saasAuth.signOut()">Sign Out</button>
  </div>
</div>
<script>
  document.getElementById('saas-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('saas-email').value;
    const password = document.getElementById('saas-password').value;
    const { error } = await saasAuth.signIn(email, password);
    if (error) alert(error.message);
  });
  document.addEventListener('saas:auth', (e) => {
    const el = document.getElementById('saas-user-email');
    if (el && e.detail.session) el.textContent = e.detail.session.user.email;
  });
</script>
`.trim()
  }

  // STRIPE SNIPPET
  if (features.stripe) {
    snippets.stripe_init = `
<script>
  const stripe = Stripe(window.__SAAS_CONFIG__.stripeKey);
  
  window.saasStripe = {
    checkout: async (priceId, mode = 'subscription') => {
      const response = await fetch(window.__SAAS_CONFIG__.supabaseUrl + '/functions/v1/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (await supabase.auth.getSession()).data.session?.access_token
        },
        body: JSON.stringify({
          tenant_id: window.__SAAS_CONFIG__.tenantId,
          price_id: priceId,
          mode: mode,
          success_url: window.location.href + '?checkout=success',
          cancel_url: window.location.href + '?checkout=cancelled'
        })
      });
      const { url } = await response.json();
      window.location.href = url;
    },
    
    portal: async () => {
      const response = await fetch(window.__SAAS_CONFIG__.supabaseUrl + '/functions/v1/customer-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (await supabase.auth.getSession()).data.session?.access_token
        },
        body: JSON.stringify({ tenant_id: window.__SAAS_CONFIG__.tenantId })
      });
      const { url } = await response.json();
      window.location.href = url;
    }
  };
</script>
`.trim()

    snippets.stripe_button = `
<button class="saas-checkout-btn" data-price-id="YOUR_PRICE_ID">
  Subscribe Now
</button>
<script>
  document.querySelectorAll('.saas-checkout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const priceId = btn.dataset.priceId;
      const mode = btn.dataset.mode || 'subscription';
      saasStripe.checkout(priceId, mode);
    });
  });
</script>
`.trim()
  }

  // GOOGLE ADS SNIPPET
  if (features.gads_matching) {
    snippets.gads_init = `
<script>
  (async function() {
    const params = new URLSearchParams(window.location.search);
    const gclid = params.get('gclid');
    const keyword = params.get('keyword') || params.get('utm_term');
    
    if (!gclid && !keyword) return;
    
    try {
      const response = await fetch(window.__SAAS_CONFIG__.gadsEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_id: window.__SAAS_CONFIG__.pageId,
          gclid: gclid,
          keyword: keyword,
          url: window.location.href
        })
      });
      
      const { replacements } = await response.json();
      
      if (replacements) {
        Object.entries(replacements).forEach(([selector, text]) => {
          document.querySelectorAll('[data-gads="' + selector + '"]').forEach(el => {
            el.textContent = text;
          });
        });
      }
    } catch (e) {
      console.warn('GAds matching failed:', e);
    }
  })();
</script>
`.trim()

    snippets.gads_example = `
<!-- Mark elements for dynamic replacement -->
<h1 data-gads="headline">Default Headline</h1>
<p data-gads="subheadline">Default subheadline text</p>
<button data-gads="cta">Get Started</button>
`.trim()
  }

  // Update page with gads config if provided
  if (gads_config && page_id) {
    await supabase
      .from('pages')
      .update({ gads_config })
      .eq('id', page_id)
      .eq('tenant_id', tenant_id)
  }

  return new Response(JSON.stringify({
    environment,
    tenant_id,
    page_id,
    snippets,
    instructions: {
      head: "Add snippets.head inside your <head> tag",
      auth: features.auth ? "Add snippets.auth_init after head, add snippets.auth_form where you want the login UI" : null,
      stripe: features.stripe ? "Add snippets.stripe_init after auth, use data-price-id on buttons" : null,
      gads: features.gads_matching ? "Add snippets.gads_init before </body>, use data-gads attributes on elements" : null,
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
