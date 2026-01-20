# Supabase SaaS MCP Server

MCP (Model Context Protocol) server that exposes all Supabase SaaS Edge Functions as AI tools.

## Installation

```bash
cd mcp-server
npm install
npm run build
```

## Configuration

Set environment variables:

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="eyJ..."
export ADMIN_KEY="your-admin-key"
export SUPABASE_USER_TOKEN="user-jwt-token"  # Optional
```

## Usage with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "supabase-saas": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_ANON_KEY": "eyJ...",
        "ADMIN_KEY": "your-admin-key"
      }
    }
  }
}
```

## Available Tools

### Tenant & Team
- `provision_tenant` - Create new tenant
- `invite_team_member` - Send team invite
- `accept_invite` - Accept invitation

### Domain & Email  
- `manage_domain` - Add/verify/delete domains

### Billing
- `create_checkout` - Stripe checkout
- `customer_portal` - Billing portal
- `check_usage_limits` - Check plan limits
- `track_usage` - Record usage

### Deployment
- `setup_page` - Get page snippets
- `deploy_page` - Deploy to Cloudflare

### Services
- `discover_services` - List services
- `configure_service` - Configure service
- `check_service_health` - Health check

### API Keys
- `create_api_key` - Generate key
- `validate_api_key` - Validate key

### Infrastructure (Admin)
- `manage_functions` - CRUD Edge Functions
- `manage_secrets` - CRUD env secrets
- `manage_database` - CRUD tables
- `manage_cron` - CRUD cron jobs
- `manage_vault` - CRUD encrypted secrets

### Monitoring
- `log_activity` - Record audit event
- `get_function_registry` - List all functions

## Example Usage

```
User: Create a new cron job that cleans up old sessions every night

AI: [calls manage_cron with action=create, job_name=cleanup-sessions, schedule="0 2 * * *", command="DELETE FROM sessions WHERE created_at < now() - interval '7 days'"]

Done! Created cron job 'cleanup-sessions' that runs at 2 AM daily.
```

```
User: What tables do we have?

AI: [calls manage_database with action=list_tables]

Here are your database tables:
- tenants (12 columns, RLS enabled)
- user_tenants (8 columns, RLS enabled)
- pages (15 columns, tenant isolated)
...
```

```
User: Add an OpenAI API key for this tenant

AI: [calls manage_vault with action=create, secret_name=OPENAI_API_KEY, secret_value=sk-..., scope=tenant]

Created encrypted secret 'OPENAI_API_KEY' for your tenant.
```
