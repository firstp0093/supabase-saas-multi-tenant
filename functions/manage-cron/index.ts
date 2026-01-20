// =====================================================
// MANAGE CRON JOBS (pg_cron)
// Create, update, delete scheduled jobs
// For AI-driven infrastructure management
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
}

const ADMIN_KEY = Deno.env.get('ADMIN_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  // Require admin key
  const adminKey = req.headers.get('X-Admin-Key')
  if (!adminKey || adminKey !== ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized - Admin key required' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const { action, job_name, schedule, command, description, active } = await req.json()
  
  // ===== LIST CRON JOBS =====
  if (action === 'list') {
    try {
      const { data, error } = await supabase.rpc('list_cron_jobs')
      
      if (error) {
        // Fallback to direct query
        const { data: jobs, error: queryError } = await supabase
          .from('cron.job')
          .select('*')
        
        if (queryError) {
          // Try raw SQL via exec_sql
          const result = await executeSql(supabase, `
            SELECT jobid, jobname, schedule, command, nodename, nodeport, database, username, active
            FROM cron.job
            ORDER BY jobname
          `)
          return new Response(JSON.stringify({ success: true, jobs: result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
        
        return new Response(JSON.stringify({ success: true, jobs }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      return new Response(JSON.stringify({ success: true, jobs: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== GET JOB DETAILS =====
  if (action === 'get') {
    if (!job_name) {
      return new Response(JSON.stringify({ error: 'job_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      const job = await executeSql(supabase, `
        SELECT jobid, jobname, schedule, command, nodename, nodeport, database, username, active
        FROM cron.job
        WHERE jobname = '${job_name}'
      `)
      
      // Get recent runs
      const runs = await executeSql(supabase, `
        SELECT runid, job_id, status, return_message, start_time, end_time
        FROM cron.job_run_details
        WHERE job_id = (SELECT jobid FROM cron.job WHERE jobname = '${job_name}')
        ORDER BY start_time DESC
        LIMIT 10
      `)
      
      return new Response(JSON.stringify({ 
        success: true, 
        job: job?.[0] || null,
        recent_runs: runs || []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== CREATE CRON JOB =====
  if (action === 'create') {
    if (!job_name || !schedule || !command) {
      return new Response(JSON.stringify({ 
        error: 'job_name, schedule, and command required',
        example: {
          job_name: 'cleanup-old-logs',
          schedule: '0 3 * * *',  // Every day at 3 AM
          command: "DELETE FROM activity_log WHERE created_at < now() - interval '90 days'",
          description: 'Clean up logs older than 90 days'
        },
        schedule_examples: {
          'every_minute': '* * * * *',
          'every_hour': '0 * * * *',
          'every_day_3am': '0 3 * * *',
          'every_monday_9am': '0 9 * * 1',
          'first_of_month': '0 0 1 * *',
          'every_5_minutes': '*/5 * * * *'
        }
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Validate job name
    if (!/^[a-z0-9_-]+$/.test(job_name)) {
      return new Response(JSON.stringify({ error: 'Job name must be lowercase alphanumeric with hyphens/underscores' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Validate cron schedule format (basic check)
    const cronParts = schedule.split(' ')
    if (cronParts.length !== 5) {
      return new Response(JSON.stringify({ 
        error: 'Invalid cron schedule. Must have 5 parts: minute hour day month weekday',
        example: '0 3 * * *  (every day at 3 AM)'
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      // Create the cron job using cron.schedule
      const result = await executeSql(supabase, `
        SELECT cron.schedule('${job_name}', '${schedule}', $$${command}$$)
      `)
      
      // Log the action
      await supabase.from('activity_log').insert({
        action: 'cron.job_created',
        resource_type: 'cron_job',
        resource_id: job_name,
        metadata: { schedule, command: command.substring(0, 200), description }
      })
      
      return new Response(JSON.stringify({
        success: true,
        job_name,
        schedule,
        message: `Cron job '${job_name}' created successfully`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== UPDATE CRON JOB =====
  if (action === 'update') {
    if (!job_name) {
      return new Response(JSON.stringify({ error: 'job_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      // Get current job
      const currentJob = await executeSql(supabase, `
        SELECT jobid, schedule, command FROM cron.job WHERE jobname = '${job_name}'
      `)
      
      if (!currentJob || currentJob.length === 0) {
        return new Response(JSON.stringify({ error: 'Job not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      const newSchedule = schedule || currentJob[0].schedule
      const newCommand = command || currentJob[0].command
      
      // Update by unscheduling and rescheduling
      await executeSql(supabase, `SELECT cron.unschedule('${job_name}')`)
      await executeSql(supabase, `SELECT cron.schedule('${job_name}', '${newSchedule}', $$${newCommand}$$)`)
      
      // Handle active/inactive
      if (active === false) {
        await executeSql(supabase, `
          UPDATE cron.job SET active = false WHERE jobname = '${job_name}'
        `)
      } else if (active === true) {
        await executeSql(supabase, `
          UPDATE cron.job SET active = true WHERE jobname = '${job_name}'
        `)
      }
      
      // Log
      await supabase.from('activity_log').insert({
        action: 'cron.job_updated',
        resource_type: 'cron_job',
        resource_id: job_name,
        metadata: { schedule: newSchedule, active }
      })
      
      return new Response(JSON.stringify({
        success: true,
        job_name,
        schedule: newSchedule,
        active: active !== false
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== DELETE CRON JOB =====
  if (action === 'delete') {
    if (!job_name) {
      return new Response(JSON.stringify({ error: 'job_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      await executeSql(supabase, `SELECT cron.unschedule('${job_name}')`)
      
      // Log
      await supabase.from('activity_log').insert({
        action: 'cron.job_deleted',
        resource_type: 'cron_job',
        resource_id: job_name
      })
      
      return new Response(JSON.stringify({ success: true, deleted: job_name }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== RUN JOB NOW =====
  if (action === 'run_now') {
    if (!job_name) {
      return new Response(JSON.stringify({ error: 'job_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      // Get the job's command
      const job = await executeSql(supabase, `
        SELECT command FROM cron.job WHERE jobname = '${job_name}'
      `)
      
      if (!job || job.length === 0) {
        return new Response(JSON.stringify({ error: 'Job not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      // Execute the command directly
      const result = await executeSql(supabase, job[0].command)
      
      // Log
      await supabase.from('activity_log').insert({
        action: 'cron.job_manual_run',
        resource_type: 'cron_job',
        resource_id: job_name
      })
      
      return new Response(JSON.stringify({ success: true, job_name, result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== GET JOB HISTORY =====
  if (action === 'history') {
    const { limit = 50 } = await req.json()
    
    try {
      const history = await executeSql(supabase, `
        SELECT 
          j.jobname,
          r.runid,
          r.status,
          r.return_message,
          r.start_time,
          r.end_time,
          EXTRACT(EPOCH FROM (r.end_time - r.start_time)) as duration_seconds
        FROM cron.job_run_details r
        JOIN cron.job j ON j.jobid = r.job_id
        ${job_name ? `WHERE j.jobname = '${job_name}'` : ''}
        ORDER BY r.start_time DESC
        LIMIT ${limit}
      `)
      
      return new Response(JSON.stringify({ success: true, history }), {
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
    available: ['list', 'get', 'create', 'update', 'delete', 'run_now', 'history']
  }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})

async function executeSql(supabase: any, sql: string): Promise<any> {
  const { data, error } = await supabase.rpc('exec_sql', { query: sql })
  if (error) throw new Error(`SQL Error: ${error.message}`)
  return data
}
