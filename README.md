# Supabase Multi-Tenant SaaS Infrastructure

A complete multi-tenant SaaS backend built on Supabase with Stripe billing, Cloudflare deployment, and Google Ads integration.

## Features

- **Multi-tenancy** - Full tenant isolation with RLS
- **Team Management** - Invite members, manage roles
- **Usage Tracking** - Plan limits with automatic enforcement
- **API Keys** - Programmatic access for developers
- **Service Discovery** - Dynamic feature catalog
- **Stripe Integration** - Subscriptions, checkout, customer portal
- **Cloudflare Pages** - One-click deployment
- **Google Ads** - Dynamic message matching

## Quick Start

1. Run SQL migrations in order (`sql/01-*.sql` through `sql/08-*.sql`)
2. Deploy all 18 Edge Functions
3. Configure secrets in Supabase dashboard
4. See [SETUP-COMPLETE.md](SETUP-COMPLETE.md) for detailed instructions

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     YOUR FRONTEND APP                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   SUPABASE EDGE FUNCTIONS                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ Auth/Tenant │ │  Billing    │ │  Deploy     │            │
│  │ Management  │ │  & Usage    │ │  & Pages    │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Supabase    │    │    Stripe     │    │  Cloudflare   │
│   Database    │    │   Payments    │    │    Pages      │
└───────────────┘    └───────────────┘    └───────────────┘
```

## Database Schema

### Core Tables
- `tenants` - Organizations/workspaces
- `user_tenants` - User membership with roles
- `invites` - Pending team invitations

### App Tables (with tenant_id)
- `pages` - Generated landing pages
- `agents` - AI agents configuration
- `workflows` - Automation workflows
- `crawlers` - Web crawlers
- `documents` - Uploaded documents
- `mcp_servers` - MCP server configs
- `settings` - Tenant settings

### Platform Tables
- `services` - Available service catalog
- `service_status` - Health monitoring
- `tenant_services` - Per-tenant service config
- `plan_limits` - Feature limits by plan
- `usage_records` - Aggregated usage
- `api_keys` - Developer API keys
- `activity_log` - Audit trail

## Edge Functions (18 total)

### Tenant & Auth
| Function | Purpose |
|:--|:--|
| `provision-tenant` | Create tenant + Stripe customer |
| `invite-team-member` | Send team invite |
| `accept-invite` | Join a tenant |

### Billing
| Function | Purpose |
|:--|:--|
| `create-checkout` | Stripe checkout session |
| `customer-portal` | Stripe billing portal |
| `stripe-webhook` | Handle Stripe events |
| `check-usage-limits` | Verify plan limits |
| `track-usage` | Record usage events |

### Deployment
| Function | Purpose |
|:--|:--|
| `setup-page` | Get injectable snippets |
| `deploy-page` | Push to Cloudflare Pages |
| `gads-message-match` | Dynamic ad content |

### Service Discovery
| Function | Purpose |
|:--|:--|
| `discover-services` | List available services |
| `configure-service` | Enable/configure service |
| `check-service-health` | Monitor service status |
| `update-service-catalog` | Admin: manage services |

### Developer Tools
| Function | Purpose |
|:--|:--|
| `create-api-key` | Generate API key |
| `validate-api-key` | Verify API key |
| `log-activity` | Record audit events |

## Plan Limits

| Feature | Free | Starter | Pro | Enterprise |
|:--|:--|:--|:--|:--|
| Pages | 3 | 10 | 50 | Unlimited |
| Deployments/mo | 10 | 100 | 500 | Unlimited |
| Team Members | 1 | 3 | 10 | Unlimited |
| API Calls/mo | 100 | 1,000 | 10,000 | Unlimited |
| Storage (MB) | 100 | 1,000 | 10,000 | Unlimited |
| Custom Domains | 0 | 1 | 5 | Unlimited |

## Environment Variables

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_LIVE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
ADMIN_KEY=your-admin-secret
APP_URL=https://your-app.com
```

## License

MIT
