-- Roda uma vez, na criação do volume. Senhas só para uso local (loopback).
-- lavaos_owner: dono dos objetos e das migrations (DDL). lavaos_app: runtime, somente DML.
CREATE ROLE lavaos_owner LOGIN PASSWORD 'owner_local_dev';
CREATE ROLE lavaos_app LOGIN PASSWORD 'app_local_dev';
CREATE DATABASE lavaos_dev OWNER lavaos_owner;
CREATE DATABASE lavaos_test OWNER lavaos_owner;

\connect lavaos_dev
GRANT USAGE ON SCHEMA public TO lavaos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lavaos_owner GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lavaos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lavaos_owner GRANT USAGE, SELECT ON SEQUENCES TO lavaos_app;

\connect lavaos_test
GRANT USAGE ON SCHEMA public TO lavaos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lavaos_owner GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lavaos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lavaos_owner GRANT USAGE, SELECT ON SEQUENCES TO lavaos_app;
