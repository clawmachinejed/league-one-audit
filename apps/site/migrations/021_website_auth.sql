-- Maintained Better Auth 1.6.23 core schema with database-backed rate limiting.
-- Default model/field names match getAuthTables(); UUIDs are not substituted for
-- the library's opaque text identifiers. The application never runs migrations.
-- Auth credentials have no FK to public application data and no shared grants.
CREATE SCHEMA website_auth;
REVOKE ALL ON SCHEMA website_auth FROM PUBLIC;

CREATE TABLE website_auth."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  image text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE website_auth.session (
  id text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES website_auth."user"(id) ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON website_auth.session("userId");

CREATE TABLE website_auth.account (
  id text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES website_auth."user"(id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL
);
CREATE INDEX "account_userId_idx" ON website_auth.account("userId");

CREATE TABLE website_auth.verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX verification_identifier_idx ON website_auth.verification(identifier);

CREATE TABLE website_auth."rateLimit" (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  "lastRequest" bigint NOT NULL
);

-- Schema-owner defaults must not accidentally expose credentials to PUBLIC or
-- an already-existing app/worker/auth role. Provision the auth role separately.
REVOKE ALL ON ALL TABLES IN SCHEMA website_auth FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA website_auth FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA website_auth FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA website_auth FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA website_auth FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA website_auth FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA website_auth FROM %I',role_name);
    END IF;
  END LOOP;
END; $$;
