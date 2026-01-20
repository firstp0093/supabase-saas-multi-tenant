import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_API_KEY = Deno.env.get('RESEND_FULL')!
const PORKBUN_API_KEY = Deno.env.get('PORKBUN_API_KEY')!
const PORKBUN_SECRET_KEY = Deno.env.get('PORKBUN_SECRET_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const authHeader = req.headers.get('Authorization')!
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const { data: userTenant } = await supabase
    .from('user_tenants')
    .select('tenant_id, role, tenants(name, slug)')
    .eq('user_id', user.id)
    .eq('is_default', true)
    .single()
  
  if (!userTenant || !['owner', 'admin'].includes(userTenant.role)) {
    return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const { action, domain, domain_id, email_from_name, email_from_address } = await req.json()
  
  // ===== LIST DOMAINS =====
  if (action === 'list') {
    const { data: domains } = await supabase
      .from('domains')
      .select('*')
      .eq('tenant_id', userTenant.tenant_id)
      .order('is_primary', { ascending: false })
    
    return new Response(JSON.stringify({ domains }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // ===== ADD DOMAIN =====
  if (action === 'add') {
    if (!domain || !domain.includes('.')) {
      return new Response(JSON.stringify({ error: 'Invalid domain' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Check if first domain (will be primary)
    const { count } = await supabase
      .from('domains')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', userTenant.tenant_id)
    
    const isPrimary = (count || 0) === 0
    
    // Add domain to Resend
    let resendDomainId = null
    let dnsRecords = []
    
    try {
      const resendResponse = await fetch('https://api.resend.com/domains', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: domain })
      })
      
      const resendData = await resendResponse.json()
      
      if (resendResponse.ok) {
        resendDomainId = resendData.id
        dnsRecords = resendData.records || []
      }
    } catch (e) {
      console.error('Resend error:', e)
    }
    
    // Create domain record
    const { data: newDomain, error: domainError } = await supabase
      .from('domains')
      .insert({
        tenant_id: userTenant.tenant_id,
        domain,
        is_primary: isPrimary,
        resend_domain_id: resendDomainId,
        dns_records: dnsRecords,
        email_from_name: email_from_name || userTenant.tenants.name,
        email_from_address: email_from_address || 'hello'
      })
      .select()
      .single()
    
    if (domainError) {
      return new Response(JSON.stringify({ error: domainError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Log activity
    await supabase.from('activity_log').insert({
      tenant_id: userTenant.tenant_id,
      user_id: user.id,
      action: 'domain.added',
      resource_type: 'domain',
      resource_id: newDomain.id,
      metadata: { domain }
    })
    
    return new Response(JSON.stringify({
      success: true,
      domain: newDomain,
      dns_records: dnsRecords,
      message: 'Domain added. Configure DNS records to verify.'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // ===== VERIFY DOMAIN =====
  if (action === 'verify') {
    if (!domain_id) {
      return new Response(JSON.stringify({ error: 'domain_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    const { data: domainRecord } = await supabase
      .from('domains')
      .select('*')
      .eq('id', domain_id)
      .eq('tenant_id', userTenant.tenant_id)
      .single()
    
    if (!domainRecord) {
      return new Response(JSON.stringify({ error: 'Domain not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Check verification with Resend
    let verified = false
    let verificationDetails = {}
    
    if (domainRecord.resend_domain_id) {
      try {
        const verifyResponse = await fetch(
          `https://api.resend.com/domains/${domainRecord.resend_domain_id}/verify`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` }
          }
        )
        
        // Get domain status
        const statusResponse = await fetch(
          `https://api.resend.com/domains/${domainRecord.resend_domain_id}`,
          {
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` }
          }
        )
        
        const statusData = await statusResponse.json()
        verified = statusData.status === 'verified'
        verificationDetails = statusData
      } catch (e) {
        console.error('Verification error:', e)
      }
    }
    
    // Update domain record
    if (verified) {
      await supabase
        .from('domains')
        .update({
          is_verified: true,
          verified_at: new Date().toISOString(),
          email_enabled: true,
          dns_configured: true
        })
        .eq('id', domain_id)
    }
    
    // Log verification attempt
    await supabase.from('domain_verifications').insert({
      domain_id,
      verification_type: 'dns',
      status: verified ? 'success' : 'pending',
      details: verificationDetails
    })
    
    return new Response(JSON.stringify({
      verified,
      domain: domainRecord.domain,
      details: verificationDetails
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // ===== SET PRIMARY =====
  if (action === 'set_primary') {
    if (!domain_id) {
      return new Response(JSON.stringify({ error: 'domain_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Unset current primary
    await supabase
      .from('domains')
      .update({ is_primary: false })
      .eq('tenant_id', userTenant.tenant_id)
      .eq('is_primary', true)
    
    // Set new primary
    const { data: updated } = await supabase
      .from('domains')
      .update({ is_primary: true })
      .eq('id', domain_id)
      .eq('tenant_id', userTenant.tenant_id)
      .select()
      .single()
    
    return new Response(JSON.stringify({ success: true, domain: updated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // ===== UPDATE EMAIL CONFIG =====
  if (action === 'update_email') {
    if (!domain_id) {
      return new Response(JSON.stringify({ error: 'domain_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    const { data: updated } = await supabase
      .from('domains')
      .update({
        email_from_name: email_from_name,
        email_from_address: email_from_address,
        updated_at: new Date().toISOString()
      })
      .eq('id', domain_id)
      .eq('tenant_id', userTenant.tenant_id)
      .select()
      .single()
    
    return new Response(JSON.stringify({ success: true, domain: updated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // ===== DELETE DOMAIN =====
  if (action === 'delete') {
    if (!domain_id) {
      return new Response(JSON.stringify({ error: 'domain_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    const { data: domainRecord } = await supabase
      .from('domains')
      .select('*')
      .eq('id', domain_id)
      .eq('tenant_id', userTenant.tenant_id)
      .single()
    
    if (!domainRecord) {
      return new Response(JSON.stringify({ error: 'Domain not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Remove from Resend
    if (domainRecord.resend_domain_id) {
      try {
        await fetch(
          `https://api.resend.com/domains/${domainRecord.resend_domain_id}`,
          {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` }
          }
        )
      } catch (e) {
        console.error('Resend delete error:', e)
      }
    }
    
    // Delete from database
    await supabase.from('domains').delete().eq('id', domain_id)
    
    // Log
    await supabase.from('activity_log').insert({
      tenant_id: userTenant.tenant_id,
      user_id: user.id,
      action: 'domain.deleted',
      resource_type: 'domain',
      metadata: { domain: domainRecord.domain }
    })
    
    return new Response(JSON.stringify({ success: true, deleted: domainRecord.domain }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  return new Response(JSON.stringify({ error: 'Invalid action' }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
