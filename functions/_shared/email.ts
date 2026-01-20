// =====================================================
// EMAIL SERVICE - Multi-domain support via Resend
// =====================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_FULL')!
const RESEND_API_URL = 'https://api.resend.com'

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string  // Full from address, e.g., "Support <hello@kurs.ing>"
  replyTo?: string
  tags?: { name: string; value: string }[]
}

export interface EmailResult {
  success: boolean
  id?: string
  error?: string
}

// Send email via Resend
export async function sendEmail(options: SendEmailOptions): Promise<EmailResult> {
  try {
    const response = await fetch(`${RESEND_API_URL}/emails`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: options.from || 'Kurs.ing <hello@kurs.ing>',
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
        reply_to: options.replyTo,
        tags: options.tags
      })
    })

    const data = await response.json()

    if (!response.ok) {
      return { success: false, error: data.message || 'Failed to send email' }
    }

    return { success: true, id: data.id }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// Get from address for a domain
export async function getFromAddress(
  supabase: any,
  domainId?: string,
  tenantId?: string
): Promise<{ from: string; domain: string }> {
  // Default fallback
  const defaultFrom = { from: 'Kurs.ing <hello@kurs.ing>', domain: 'kurs.ing' }

  if (!domainId && !tenantId) return defaultFrom

  let query = supabase.from('domains').select('domain, email_from_name, email_from_address, email_enabled')
  
  if (domainId) {
    query = query.eq('id', domainId)
  } else if (tenantId) {
    query = query.eq('tenant_id', tenantId).eq('is_primary', true)
  }

  const { data: domainRecord } = await query.eq('is_verified', true).eq('email_enabled', true).single()

  if (!domainRecord) return defaultFrom

  const fromName = domainRecord.email_from_name || domainRecord.domain
  const fromAddress = domainRecord.email_from_address || 'hello'
  
  return {
    from: `${fromName} <${fromAddress}@${domainRecord.domain}>`,
    domain: domainRecord.domain
  }
}

// Send email using template
export async function sendTemplateEmail(
  supabase: any,
  options: {
    templateName: string
    to: string
    variables: Record<string, string>
    tenantId: string
    domainId?: string
  }
): Promise<EmailResult> {
  // Get template
  let templateQuery = supabase
    .from('email_templates')
    .select('*')
    .eq('tenant_id', options.tenantId)
    .eq('name', options.templateName)
    .eq('is_active', true)

  if (options.domainId) {
    templateQuery = templateQuery.eq('domain_id', options.domainId)
  }

  const { data: template } = await templateQuery.single()

  // Fall back to default template (no domain_id)
  if (!template) {
    const { data: defaultTemplate } = await supabase
      .from('email_templates')
      .select('*')
      .eq('tenant_id', options.tenantId)
      .eq('name', options.templateName)
      .is('domain_id', null)
      .eq('is_active', true)
      .single()

    if (!defaultTemplate) {
      return { success: false, error: `Template '${options.templateName}' not found` }
    }

    return sendWithTemplate(supabase, defaultTemplate, options)
  }

  return sendWithTemplate(supabase, template, options)
}

async function sendWithTemplate(
  supabase: any,
  template: any,
  options: {
    to: string
    variables: Record<string, string>
    tenantId: string
    domainId?: string
  }
): Promise<EmailResult> {
  // Replace variables in template
  let subject = template.subject
  let html = template.html_content
  let text = template.text_content || ''

  for (const [key, value] of Object.entries(options.variables)) {
    const regex = new RegExp(`{{${key}}}`, 'g')
    subject = subject.replace(regex, value)
    html = html.replace(regex, value)
    text = text.replace(regex, value)
  }

  // Get from address
  const { from, domain } = await getFromAddress(supabase, options.domainId, options.tenantId)

  // Send email
  const result = await sendEmail({ to: options.to, subject, html, text, from })

  // Log the email
  await supabase.from('email_log').insert({
    tenant_id: options.tenantId,
    domain_id: options.domainId,
    to_email: options.to,
    from_email: from,
    subject,
    template_name: template.name,
    resend_id: result.id,
    status: result.success ? 'sent' : 'failed',
    error_message: result.error,
    metadata: { variables: options.variables }
  })

  return result
}

// Quick send without template
export async function sendQuickEmail(
  supabase: any,
  options: {
    to: string
    subject: string
    html: string
    text?: string
    tenantId: string
    domainId?: string
  }
): Promise<EmailResult> {
  const { from, domain } = await getFromAddress(supabase, options.domainId, options.tenantId)

  const result = await sendEmail({
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    from
  })

  // Log
  await supabase.from('email_log').insert({
    tenant_id: options.tenantId,
    domain_id: options.domainId,
    to_email: options.to,
    from_email: from,
    subject: options.subject,
    resend_id: result.id,
    status: result.success ? 'sent' : 'failed',
    error_message: result.error
  })

  return result
}
