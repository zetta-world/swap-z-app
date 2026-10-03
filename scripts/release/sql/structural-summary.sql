WITH items AS (
  SELECT 'relation'::text AS category,
         format('%I.%I|kind=%s|owner=%I|persist=%s|rls=%s|force=%s|acl=%s',
                n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner),
                c.relpersistence, c.relrowsecurity, c.relforcerowsecurity,
                coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text)
                            FROM unnest(coalesce(c.relacl, acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END, c.relowner))) x), '')) AS line
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r','p','v','m','S','f')

  UNION ALL
  SELECT 'column',
         format('%I.%I.%I|type=%s|nn=%s|identity=%s|generated=%s|default=%s|acl=%s',
                n.nspname, c.relname, a.attname,
                format_type(a.atttypid,a.atttypmod), a.attnotnull,
                a.attidentity, a.attgenerated,
                coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''),
                coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text)
                            FROM unnest(coalesce(a.attacl, '{}'::aclitem[])) x), ''))
    FROM pg_attribute a
    JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
     AND a.attnum>0 AND NOT a.attisdropped

  UNION ALL
  SELECT 'constraint',
         format('%I.%I.%I|%s|validated=%s|deferrable=%s|deferred=%s',
                n.nspname, c.relname, k.conname, pg_get_constraintdef(k.oid, true),
                k.convalidated, k.condeferrable, k.condeferred)
    FROM pg_constraint k
    JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public'

  UNION ALL
  SELECT 'index', format('%I.%I|%s', schemaname, indexname, indexdef)
    FROM pg_indexes WHERE schemaname='public'

  UNION ALL
  SELECT 'function',
         format('%I.%I(%s)|owner=%I|acl=%s|result=%s|language=%s|secdef=%s|volatile=%s|config=%s|body=%s',
                n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
                pg_get_userbyid(p.proowner),
                coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text)
                            FROM unnest(coalesce(p.proacl, acldefault('f',p.proowner))) x), ''),
                pg_get_function_result(p.oid), l.lanname, p.prosecdef, p.provolatile,
                coalesce(array_to_string(p.proconfig, ','), ''),
                regexp_replace(regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/','','g'),'--[^\n]*','','g'),'\s+',' ','g'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
   WHERE n.nspname='public'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')

  UNION ALL
  SELECT 'policy',
         format('%I.%I.%I|permissive=%s|roles=%s|cmd=%s|qual=%s|check=%s',
                schemaname, tablename, policyname, permissive,
                coalesce(array_to_string(roles, ','), ''), cmd,
                coalesce(qual,''), coalesce(with_check,''))
    FROM pg_policies WHERE schemaname='public'

  UNION ALL
  SELECT 'trigger', format('%I.%I.%I|%s', n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid,true))
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND NOT t.tgisinternal

  UNION ALL
  SELECT 'enum', format('%I.%I|%s', n.nspname,t.typname,
         string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder))
    FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
    JOIN pg_namespace n ON n.oid=t.typnamespace
   WHERE n.nspname='public' GROUP BY n.nspname,t.typname

  UNION ALL
  SELECT 'view', format('%I.%I|%s', n.nspname,c.relname,pg_get_viewdef(c.oid,true))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('v','m')

  UNION ALL
  SELECT 'comment', format('relation=%I.%I|sub=%s|%s', n.nspname,c.relname,
                           coalesce(a.attname,d.objsubid::text),d.description)
    FROM pg_description d
    JOIN pg_class c ON d.classoid='pg_class'::regclass AND c.oid=d.objoid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.objsubid AND d.objsubid>0
   WHERE n.nspname='public'

  UNION ALL
  SELECT 'comment', format('function=%I.%I(%s)|%s',n.nspname,p.proname,
                           pg_get_function_identity_arguments(p.oid),d.description)
    FROM pg_description d
    JOIN pg_proc p ON d.classoid='pg_proc'::regclass AND p.oid=d.objoid
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'

  UNION ALL
  SELECT 'comment', format('type=%I.%I|%s',n.nspname,t.typname,d.description)
    FROM pg_description d
    JOIN pg_type t ON d.classoid='pg_type'::regclass AND t.oid=d.objoid
    JOIN pg_namespace n ON n.oid=t.typnamespace
   WHERE n.nspname='public'

  UNION ALL
  SELECT 'default_acl',
         format('role=%I|schema=%s|type=%s|acl=%s', pg_get_userbyid(d.defaclrole),
                coalesce(n.nspname,''),d.defaclobjtype,
                coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text)
                            FROM unnest(coalesce(d.defaclacl,'{}'::aclitem[])) x),''))
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
   WHERE n.nspname='public'

  UNION ALL
  SELECT 'extension', format('%I|version=%s|schema=%I', e.extname,e.extversion,n.nspname)
    FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
   WHERE e.extname IN ('pgcrypto','uuid-ossp')
)
SELECT category, count(*) AS object_count,
       md5(string_agg(line, E'\n' ORDER BY line)) AS structural_hash
  FROM items
 GROUP BY category
 ORDER BY category;
