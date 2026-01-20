// supabase/functions/deploy-page/index.ts
// Deploys a page to Cloudflare Pages with production credentials

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const CF_ACCOUNT_ID = Deno.env.get('CLOUDFLARE_ACCOUNT_ID')!
  const CF_API_TOKEN = Deno.env.get('CLOUDFLARE_API_TOKEN')!
  
  const authHeader = req.headers.get('Authorization')!
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const { page_id, project_name } = await req.json()
  
  // Get tenant
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
  
  // Get page content
  const { data: page, error: pageError } = await supabase
    .from('pages')
    .select('*')
    .eq('id', page_id)
    .eq('tenant_id', tenant_id)
    .single()
  
  if (pageError || !page) {
    return new Response(JSON.stringify({ error: 'Page not found' }), { 
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Swap test credentials for production
  let html = page.content
  const liveStripeKey = Deno.env.get('STRIPE_LIVE_PUBLISHABLE_KEY')!
  html = html.replace(/stripeKey:\s*"pk_test_[^"]+"/g, `stripeKey: "${liveStripeKey}"`)
  html = html.replace(/environment:\s*"test"/g, 'environment: "production"')
  
  // Compute hash
  const htmlHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))
  const hashHex = Array.from(new Uint8Array(htmlHash)).map(b => b.toString(16).padStart(2, '0')).join('')

  const cfProjectName = project_name || page.cloudflare_project || `saas-${tenant_id.slice(0, 8)}-${page_id.slice(0, 8)}`
  
  // Ensure project exists
  const projectCheck = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${cfProjectName}`,
    { headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` } }
  )
  
  if (projectCheck.status === 404) {
    await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: cfProjectName, production_branch: 'main' })
      }
    )
  }
  
  // Deploy using Direct Upload
  const formData = new FormData()
  const manifest = { '/index.html': hashHex }
  formData.append('manifest', JSON.stringify(manifest))
  const htmlBlob = new Blob([html], { type: 'text/html' })
  formData.append(hashHex, htmlBlob, 'index.html')
  
  const deployResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${cfProjectName}/deployments`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: formData
    }
  )
  
  const deployResult = await deployResponse.json()
  
  if (!deployResult.success) {
    return new Response(JSON.stringify({ error: deployResult.errors }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const deployment = deployResult.result
  const liveUrl = `https://${cfProjectName}.pages.dev`
  
  // Update page record
  await supabase
    .from('pages')
    .update({
      status: 'deployed',
      cloudflare_project: cfProjectName,
      cloudflare_url: liveUrl,
      deployed_at: new Date().toISOString()
    })
    .eq('id', page_id)
  
  // Record deployment
  await supabase.from('page_deployments').insert({
    tenant_id,
    page_id,
    environment: 'production',
    cloudflare_deployment_id: deployment.id,
    html_hash: hashHex,
    deployed_by: user.id
  })
  
  return new Response(JSON.stringify({
    success: true,
    deployment_id: deployment.id,
    url: liveUrl,
    preview_url: deployment.url,
    project: cfProjectName
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
