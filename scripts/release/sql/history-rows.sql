-- Todas as linhas de supabase_migrations.schema_migrations como JSON (só leitura).
-- Contém created_by (pode ser um email): NUNCA publicar a saída bruta; use lib/history.mjs para comparar.
select coalesce(json_agg(row_to_json(m) order by version), '[]') from supabase_migrations.schema_migrations m;
