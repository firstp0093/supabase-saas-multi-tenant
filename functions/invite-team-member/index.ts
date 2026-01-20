import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { sendTemplateEmail, sendQuickEmail } from '../_shared/email.ts'

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
  
  // Get user's tenant with domain info
  const { data: userTenant } = await supabase
    .from('user_tenants')
    .select(`
      tenant_id, 
      role, 
      tenants(
        id, name, slug, plan,
        domains(id, domain, email_enabled, is_primary)
      )
    `)
    .eq('user_id', user.id)
    .eq('is_default', true)
    .single()
  
  if (!userTenant || !['owner', 'admin'].includes(userTenant.role)) {
    return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const { email, role, message, page_id, domain_id } = await req.json()
  
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
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  
  const { data: invite, error: inviteError } = await supabase
    .from('invites')
    .upsert({
      tenant_id: userTenant.tenant_id,
      email,
      role: role || 'member',
      token,
      invited_by: user.id,
      expires_at: expiresAt.toISOString()
    }, { onConflict: 'tenant_id,email' })
    .select()
    .single()
  
  if (inviteError) {
    return new Response(JSON.stringify({ error: inviteError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Determine which domain to send from
  let sendDomainId = domain_id
  
  // If page_id provided, get that page's domain
  if (page_id && !sendDomainId) {
    const { data: page } = await supabase
      .from('pages')
      .select('domain_id')
      .eq('id', page_id)
      .eq('tenant_id', userTenant.tenant_id)
      .single()
    
    if (page?.domain_id) sendDomainId = page.domain_id
  }
  
  // Fall back to tenant's primary domain
  if (!sendDomainId && userTenant.tenants.domains?.length > 0) {
    const primaryDomain = userTenant.tenants.domains.find((d: any) => d.is_primary && d.email_enabled)
    if (primaryDomain) sendDomainId = primaryDomain.id
  }
  
  const inviteUrl = `${Deno.env.get('APP_URL') || 'https://kurs.ing'}/invite/${token}`
  
  // Get inviter's name
  const { data: inviterProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single()
  
  const inviterName = inviterProfile?.full_name || user.email?.split('@')[0] || 'A team member'
  
  // Send invite email
  let emailResult = { success: false, error: 'Email not configured' }
  
  try {
    // Try template first
    emailResult = await sendTemplateEmail(supabase, {
      templateName: 'team_invite',
      to: email,
      variables: {
        tenant_name: userTenant.tenants.name,
        inviter_name: inviterName,
        role: role || 'member',
        invite_url: inviteUrl,
        expires_at: expiresAt.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })
      },
      tenantId: userTenant.tenant_id,
      domainId: sendDomainId
    })
  } catch (templateError) {
    // Fall back to quick email if template fails
    emailResult = await sendQuickEmail(supabase, {
      to: email,
      subject: `You've been invited to join ${userTenant.tenants.name}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">You're invited!</h2>
          <p style="color: #666; font-size: 16px; line-height: 1.5;">
            ${inviterName} has invited you to join <strong>${userTenant.tenants.name}</strong> as a ${role || 'member'}.
          </p>
          ${message ? `<p style="color: #666; font-size: 14px; background: #f5f5f5; padding: 12px; border-radius: 6px;">${message}</p>` : ''}
          <a href="${inviteUrl}" style="display: inline-block; background: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">
            Accept Invitation
          </a>
          <p style="color: #999; font-size: 14px;">This invitation expires in 7 days.</p>
        </div>
      `,
      text: `You've been invited to join ${userTenant.tenants.name}!\n\n${inviterName} has invited you as a ${role || 'member'}.\n\nAccept: ${inviteUrl}`,
      tenantId: userTenant.tenant_id,
      domainId: sendDomainId
    })
  }
  
  // Log activity
  await supabase.from('activity_log').insert({
    tenant_id: userTenant.tenant_id,
    user_id: user.id,
    action: 'team.invite_sent',
    resource_type: 'invite',
    resource_id: invite.id,
    metadata: { 
      email, 
      role,
      email_sent: emailResult.success,
      email_id: emailResult.id,
      domain_id: sendDomainId
    }
  })
  
  return new Response(JSON.stringify({
    success: true,
    invite_id: invite.id,
    invite_url: inviteUrl,
    expires_at: invite.expires_at,
    email_sent: emailResult.success,
    email_error: emailResult.error
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
