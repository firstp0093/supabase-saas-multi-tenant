// supabase/functions/gads-message-match/index.ts
// Dynamic message matching for Google Ads keywords

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
}

interface MatchRequest {
  page_id: string
  gclid?: string
  keyword?: string
  url: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const { page_id, gclid, keyword, url }: MatchRequest = await req.json()
  
  // Get page's gads_config
  const { data: page } = await supabase
    .from('pages')
    .select('gads_config, tenant_id')
    .eq('id', page_id)
    .single()
  
  if (!page?.gads_config) {
    return new Response(JSON.stringify({ replacements: null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const config = page.gads_config as {
    keywords?: Record<string, Record<string, string>>
    default?: Record<string, string>
  }
  
  // Start with defaults
  let replacements: Record<string, string> = config.default || {}
  
  // Match keyword
  if (keyword && config.keywords) {
    const lowerKeyword = keyword.toLowerCase()
    
    // Exact match first
    if (config.keywords[lowerKeyword]) {
      replacements = { ...replacements, ...config.keywords[lowerKeyword] }
    } else {
      // Partial match
      for (const [key, values] of Object.entries(config.keywords)) {
        if (lowerKeyword.includes(key.toLowerCase())) {
          replacements = { ...replacements, ...values }
          break
        }
      }
    }
  }
  
  // Log for analytics (fire and forget)
  supabase.from('gads_impressions').insert({
    tenant_id: page.tenant_id,
    page_id,
    gclid,
    keyword,
    url,
    matched_config: Object.keys(replacements).length > 0
  }).then(() => {}).catch(() => {})
  
  return new Response(JSON.stringify({ replacements }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
