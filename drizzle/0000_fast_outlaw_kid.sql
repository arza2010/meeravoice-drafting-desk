CREATE TYPE "public"."draft_stage" AS ENUM('intake', 'angles', 'draft', 'critique', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('pending', 'approved', 'rejected', 'superseded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."fragment_source" AS ENUM('voice', 'text', 'forward');--> statement-breakpoint
CREATE TYPE "public"."session_mode" AS ENUM('edit', 'reject_reason');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" serial NOT NULL,
	"fragment_ids" jsonb NOT NULL,
	"intake_json" jsonb NOT NULL,
	"pillar" text,
	"angles_json" jsonb,
	"selected_angle" text,
	"plan_json" jsonb,
	"facts_used_json" jsonb,
	"text" text,
	"checks_json" jsonb,
	"critique_json" jsonb,
	"revision_of" uuid,
	"status" "draft_status" DEFAULT 'pending' NOT NULL,
	"stage" "draft_stage" DEFAULT 'intake' NOT NULL,
	"reject_reason" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"telegram_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fragments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "fragment_source" NOT NULL,
	"telegram_message_id" bigint,
	"transcript" text NOT NULL,
	"intake_json" jsonb,
	"draftable" boolean,
	"used_in_draft_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"mode" "session_mode" NOT NULL,
	"draft_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stage_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fragment_id" uuid,
	"draft_id" uuid,
	"stage" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"retried" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telegram_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"chat_id" bigint,
	"status" text NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
