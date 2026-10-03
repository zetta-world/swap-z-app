select count(*) n, md5(string_agg(linha, E'\n' order by linha)) h from (
with
norm as (select 1),
fn as (
  select 'function' as kind,
         p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as name,
         md5(
           regexp_replace(regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/','','g'),'--[^\n]*','','g'),'\s+',' ','g')
           ||'|ret='||pg_get_function_result(p.oid)
           ||'|lang='||l.lanname
           ||'|secdef='||p.prosecdef
           ||'|vol='||p.provolatile::text
           ||'|cfg='||coalesce(array_to_string(p.proconfig,','),'')
         ) as fp,
         coalesce((select string_agg(case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||':'||a.privilege_type, ',' order by 1)
                     from aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
                    where pg_get_userbyid(a.grantee) in ('anon','authenticated','service_role') or a.grantee=0),'') as acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
   where n.nspname='public'
     and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
),
col as (
  select 'column', c.relname||'.'||a.attname,
         md5(format_type(a.atttypid,a.atttypmod)||'|nn='||a.attnotnull||'|def='||coalesce(pg_get_expr(ad.adbin,ad.adrelid),'')),
         ''
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
   where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped
),
con as (
  select 'constraint', c.relname||'.'||k.conname, md5(pg_get_constraintdef(k.oid)), ''
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
),
idx as (
  select 'index', i.indexname, md5(i.indexdef), '' from pg_indexes i where i.schemaname='public'
),
tbl as (
  select 'table', c.relname, md5('rls='||c.relrowsecurity||'|force='||c.relforcerowsecurity),
         coalesce((select string_agg(case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||':'||a.privilege_type, ',' order by 1)
                     from aclexplode(coalesce(c.relacl, acldefault('r',c.relowner))) a
                    where pg_get_userbyid(a.grantee) in ('anon','authenticated','service_role') or a.grantee=0),'')
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p')
),
pol as (
  select 'policy', tablename||'.'||policyname, md5(coalesce(cmd,'')||'|'||coalesce(array_to_string(roles,','),'')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||permissive::text), ''
    from pg_policies where schemaname='public'
),
trg as (
  select 'trigger', c.relname||'.'||t.tgname, md5(pg_get_triggerdef(t.oid)), ''
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and not t.tgisinternal
),
enm as (
  select 'enum', t.typname, md5(string_agg(e.enumlabel, ',' order by e.enumsortorder)), ''
    from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace
   where n.nspname='public' group by t.typname
),
vw as (
  select 'view', c.relname, md5(pg_get_viewdef(c.oid)), ''
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')
)
select kind||'|'||name||'|'||fp||'|'||acl as linha from (
  select * from fn union all select * from col union all select * from con union all select * from idx
  union all select * from tbl union all select * from pol union all select * from trg union all select * from enm union all select * from vw
) x
) z;
