#!/bin/sh
set -eu
: "${POSTGRES_APP_USER:?Application user is required}"
: "${POSTGRES_APP_PASSWORD:?Application password is required}"
if [ "$POSTGRES_APP_USER" = "$POSTGRES_USER" ]; then
  echo 'Application and bootstrap roles must be distinct' >&2
  exit 1
fi
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-psqlrc --set ON_ERROR_STOP=1 \
  --set app_user="$POSTGRES_APP_USER" --set app_password="$POSTGRES_APP_PASSWORD" --set app_db="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'app_user', :'app_password') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO %I', :'app_db', :'app_user') \gexec
SQL
