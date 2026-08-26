-- ============================================================================
-- Orbit — stockage des fichiers
--
-- Deux compartiments aux regles opposees :
--   `avatars`     public en lecture, chacun n'ecrit que dans son dossier ;
--   `attachments` prive, lisible seulement par les membres du salon concerne.
--
-- Le nom du fichier porte l'autorisation : le premier segment du chemin est
-- l'identifiant du proprietaire (avatars) ou du salon (pieces jointes), ce qui
-- permet aux politiques de decider sans consulter d'autre table.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2 * 1024 * 1024,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 25 * 1024 * 1024)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- ----------------------------------------------------------------------------
-- Avatars : chemin `{user_id}/{fichier}`
-- ----------------------------------------------------------------------------

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select to public
  using (bucket_id = 'avatars');

drop policy if exists avatars_write_own on storage.objects;
create policy avatars_write_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ----------------------------------------------------------------------------
-- Pieces jointes : chemin `{channel_id}/{fichier}`
-- ----------------------------------------------------------------------------

drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_channel_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists attachments_write on storage.objects;
create policy attachments_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and owner_id = (select auth.uid())::text
    and public.is_channel_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists attachments_remove on storage.objects;
create policy attachments_remove on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (
      owner_id = (select auth.uid())::text
      or public.can_manage_channel(((storage.foldername(name))[1])::uuid)
    )
  );
