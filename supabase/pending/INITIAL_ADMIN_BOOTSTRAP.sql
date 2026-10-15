-- OWNER-RUN ONLY. Run in the verified staging project's SQL Editor after
-- migrations 202610120001 and 202610120002 have committed.
-- Recommended: run only after all four proposals and their postchecks pass.
-- This script creates no Auth account, changes no existing profile role, and
-- is not an application RPC or a self-registration/self-promotion mechanism.

begin;

do $bootstrap$
declare
  expected_user_id constant uuid := '8ff7d0f3-5de0-43a1-975a-1d553bd64a27';
  expected_email constant text := 'admin@cctc.com';
  bootstrap_user_id uuid;
  created_membership uuid;
begin
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Bootstrap requires a trusted Supabase database owner; current role is not authorized.';
  end if;

  if to_regclass('auth.users') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.gcscan_admin_members') is null
     or to_regclass('public.gcscan_admin_audit') is null
     or to_regprocedure('public.gcscan_protect_profile_role()') is null
     or to_regprocedure('public.gcscan_is_admin()') is null then
    raise exception 'Bootstrap prerequisites missing: profiles, admin membership/audit, or protected role/admin functions must exist.';
  end if;

  if not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name in ('id', 'email', 'full_name', 'role')
       group by table_name
       having count(distinct column_name) = 4
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'gcscan_admin_members'
         and column_name in ('user_id', 'granted_by')
       group by table_name
       having count(distinct column_name) = 2
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'gcscan_admin_audit'
         and column_name in ('actor_id', 'action', 'subject_id', 'reason', 'after_record')
       group by table_name
       having count(distinct column_name) = 5
     ) then
    raise exception 'Bootstrap prerequisites differ from the reviewed profile, membership, or audit schema.';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where t.tgrelid = 'public.profiles'::regclass
      and t.tgname = 'gcscan_protect_profile_role'
      and not t.tgisinternal
      and t.tgenabled in ('O', 'A')
      and pn.nspname = 'public'
      and p.proname = 'gcscan_protect_profile_role'
      and p.prosrc ilike '%new.role := ''student''%'
      and p.prosrc ilike '%gcscan.admin_role_change_user_id%'
      and p.prosrc ilike '%gcscan_is_admin%'
      and (t.tgtype & 1) = 1
      and (t.tgtype & 2) = 2
      and (t.tgtype & 4) = 4
      and (t.tgtype & 16) = 16
  ) then
    raise exception 'Bootstrap blocked: reviewed student-default, membership-checked profile guard is not enabled for row INSERT and UPDATE.';
  end if;

  select u.id
  into bootstrap_user_id
  from auth.users u
  where u.id = expected_user_id
    and lower(u.email) = lower(expected_email)
  for update;
  if not found then
    raise exception 'Bootstrap blocked: the designated Auth UUID/email pair does not exist; verify it through the trusted Auth Admin workflow.';
  end if;

  if (select count(*) from auth.users u
      where lower(u.email) = lower(expected_email)) <> 1 then
    raise exception 'Bootstrap blocked: the designated email must resolve to exactly one Auth user.';
  end if;

  -- Insert only a missing profile. The existing role trigger forces student;
  -- an existing profile, including its role, is deliberately left untouched.
  insert into public.profiles (id, email, full_name, role)
  select
    u.id,
    u.email,
    coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(u.email), ''),
      'Administrator'
    ),
    'student'
  from auth.users u
  where u.id = bootstrap_user_id
    and not exists (
      select 1 from public.profiles p where p.id = u.id
    )
  on conflict (id) do nothing;

  if not exists (
    select 1 from public.profiles p where p.id = bootstrap_user_id
  ) then
    raise exception 'Bootstrap blocked: the designated Auth user has no profile; membership was not granted.';
  end if;

  insert into public.gcscan_admin_members (user_id, granted_by)
  values (bootstrap_user_id, null)
  on conflict (user_id) do nothing
  returning user_id into created_membership;

  if created_membership is not null then
    insert into public.gcscan_admin_audit
      (actor_id, action, subject_id, reason, after_record)
    values (
      null,
      'initial_admin_membership_granted',
      bootstrap_user_id,
      'Provisioned by trusted Supabase project owner.',
      jsonb_build_object(
        'user_id', bootstrap_user_id,
        'source', 'owner_bootstrap'
      )
    );
  end if;
end;
$bootstrap$;

commit;
