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
  
  const { token } = await req.json()
  
  // Find invite
  const { data: invite, error: inviteError } = await supabase
    .from('invites')
    .select('*, tenants(name, slug)')
    .eq('token', token)
    .is('accepted_at', null)
    .single()
  
  if (inviteError || !invite) {
    return new Response(JSON.stringify({ error: 'Invalid or expired invite' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  if (new Date(invite.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: 'Invite has expired' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  if (invite.email.toLowerCase() !== user.email?.toLowerCase()) {
    return new Response(JSON.stringify({ error: 'Email mismatch' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Check existing membership
  const { data: existing } = await supabase
    .from('user_tenants')
    .select('id')
    .eq('tenant_id', invite.tenant_id)
    .eq('user_id', user.id)
    .single()
  
  if (existing) {
    await supabase.from('invites').update({ accepted_at: new Date().toISOString() }).eq('id', invite.id)
    return new Response(JSON.stringify({ success: true, message: 'Already a member', tenant: invite.tenants }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Check if first tenant
  const { count } = await supabase
    .from('user_tenants')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
  
  const isDefault = (count || 0) === 0
  
  // Create membership
  const { data: membership, error: membershipError } = await supabase
    .from('user_tenants')
    .insert({
      user_id: user.id,
      tenant_id: invite.tenant_id,
      role: invite.role,
      is_default: isDefault,
      invited_by: invite.invited_by,
      invited_at: invite.created_at,
      invite_accepted_at: new Date().toISOString()
    })
    .select()
    .single()
  
  if (membershipError) {
    return new Response(JSON.stringify({ error: membershipError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Mark invite accepted
  await supabase.from('invites').update({ accepted_at: new Date().toISOString() }).eq('id', invite.id)
  
  // Log activity
  await supabase.from('activity_log').insert({
    tenant_id: invite.tenant_id,
    user_id: user.id,
    action: 'team.member_joined',
    resource_type: 'user_tenant',
    resource_id: membership.id,
    metadata: { role: invite.role }
  })
  
  return new Response(JSON.stringify({
    success: true,
    membership_id: membership.id,
    tenant: invite.tenants,
    role: invite.role,
    is_default: isDefault
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
