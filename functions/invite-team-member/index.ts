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
  
  const authHeader = req.headers.get('Authorization')!
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const { data: userTenant } = await supabase
    .from('user_tenants')
    .select('tenant_id, role, tenants(name, slug, plan)')
    .eq('user_id', user.id)
    .eq('is_default', true)
    .single()
  
  if (!userTenant || !['owner', 'admin'].includes(userTenant.role)) {
    return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const { email, role, message } = await req.json()
  
  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Check team member limit
  const { data: planLimit } = await supabase
    .from('plan_limits')
    .select('limit_value')
    .eq('plan', userTenant.tenants.plan)
    .eq('feature', 'team_members')
    .single()
  
  if (planLimit && planLimit.limit_value !== -1) {
    const { count: currentMembers } = await supabase
      .from('user_tenants')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', userTenant.tenant_id)
    
    const { count: pendingInvites } = await supabase
      .from('invites')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', userTenant.tenant_id)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
    
    if ((currentMembers || 0) + (pendingInvites || 0) >= planLimit.limit_value) {
      return new Response(JSON.stringify({ 
        error: 'Team member limit reached',
        limit: planLimit.limit_value,
        current: currentMembers,
        pending: pendingInvites
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // Create invite
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '')
  
  const { data: invite, error: inviteError } = await supabase
    .from('invites')
    .upsert({
      tenant_id: userTenant.tenant_id,
      email,
      role: role || 'member',
      token,
      invited_by: user.id,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    }, { onConflict: 'tenant_id,email' })
    .select()
    .single()
  
  if (inviteError) {
    return new Response(JSON.stringify({ error: inviteError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Log activity
  await supabase.from('activity_log').insert({
    tenant_id: userTenant.tenant_id,
    user_id: user.id,
    action: 'team.invite_sent',
    resource_type: 'invite',
    resource_id: invite.id,
    metadata: { email, role }
  })
  
  const inviteUrl = `${Deno.env.get('APP_URL') || 'https://your-app.com'}/invite/${token}`
  
  return new Response(JSON.stringify({
    success: true,
    invite_id: invite.id,
    invite_url: inviteUrl,
    expires_at: invite.expires_at
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
