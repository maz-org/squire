-- Bootstrap script run by the pgvector/pgvector:pg16 image the first time the
-- data volume is created. Creates the pgvector extension and the test database
-- used by `npm test`. Safe to re-run (CREATE ... IF NOT EXISTS).
CREATE EXTENSION IF NOT EXISTS vector;

SELECT 'CREATE DATABASE squire_test OWNER squire'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'squire_test')\gexec

\connect squire_test
CREATE EXTENSION IF NOT EXISTS vector;
