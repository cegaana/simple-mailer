-- =====================================================================
-- Simple Mailer Subsystem — Canonical SQLite Schema - Draft
-- Target: SQLite (better-sqlite3)
-- Purpose: Standalone email queue, campaign lifecycle, templates,
--          suppression lists, and granular dispatch audit logging.
-- =====================================================================

-- 1. Campaign Entity (First-Class Citizen)
CREATE TABLE IF NOT EXISTS _mailer_campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    template_id TEXT,
    -- Reserved for deferred inline templates (design doc §6). Unused in v1:
    -- campaigns reference a template by template_id.
    template_text TEXT,
    template_html TEXT,
    status TEXT NOT NULL DEFAULT 'draft', -- draft, scheduled, running, paused, completed, cancelled
    scheduled_at TEXT,
    -- Cumulative across every enqueueRecipients() call for this campaign.
    -- Suppressed rows never reach _mailer_queue, so this is the only place
    -- that count survives past the one-time enqueue result.
    suppressed_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 2. Message Templates
CREATE TABLE IF NOT EXISTS _mailer_templates (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT NOT NULL,
    signature_id TEXT,
    sample_data_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 3. Reusable Sender Signatures
CREATE TABLE IF NOT EXISTS _mailer_signatures (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    signature_html TEXT NOT NULL,
    signature_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 4. Isolated Delivery Queue
CREATE TABLE IF NOT EXISTS _mailer_queue (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    recipient_id TEXT, -- Loose reference to external CRM contact (optional)
    email TEXT NOT NULL,
    name TEXT,
    metadata_json TEXT, -- JSON blob holding merge tags (first_name, tier, dietary, etc.)
    status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, retrying, sent, failed, cancelled
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    locked_at TEXT, -- Worker lease lock timestamp
    next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    error_message TEXT,
    provider_message_id TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (campaign_id) REFERENCES _mailer_campaigns(id) ON DELETE CASCADE,
    UNIQUE (campaign_id, email)
);

-- Optimized Performance Indexes for Claiming & Filtering
CREATE INDEX IF NOT EXISTS idx_mailer_queue_claim 
ON _mailer_queue(status, next_attempt_at) 
WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_mailer_queue_campaign_status 
ON _mailer_queue(campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_mailer_queue_email 
ON _mailer_queue(email);

-- 5. Opt-Out & Suppression Table
CREATE TABLE IF NOT EXISTS _mailer_suppression (
    email TEXT PRIMARY KEY,
    reason TEXT NOT NULL, -- unsubscribe, hard_bounce, spam_complaint, manual
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 6. Granular Dispatch Audit Logs
CREATE TABLE IF NOT EXISTS _mailer_logs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    error TEXT,
    provider_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- PRD §2 specifies this index; it was missing from the DDL.
CREATE INDEX IF NOT EXISTS idx_mailer_logs_campaign
ON _mailer_logs(campaign_id, created_at);

CREATE INDEX IF NOT EXISTS idx_mailer_campaigns_status
ON _mailer_campaigns(status);
