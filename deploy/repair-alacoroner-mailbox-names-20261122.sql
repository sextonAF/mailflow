-- One-time, non-destructive correction of the original ALA Coroner
-- auto-provisioning placeholder. Does not change mailbox credentials,
-- stored messages, user identity, or customized account names.
--
-- On subsequent ALA Coroner ID sign-ins, MailFlow updates these names from
-- Central Admin's exact first_name and last_name.
BEGIN;
WITH to_fix AS (
  SELECT a.id,
         CASE
           WHEN trim(coalesce(u.display_name,'')) <> ''
             AND lower(trim(u.display_name)) <> lower(u.username)
             AND trim(u.display_name) !~ '[[:cntrl:]]'
           THEN trim(u.display_name)
           ELSE initcap(replace(split_part(a.email_address,'@',1),'.',' '))
         END AS full_name
    FROM email_accounts a
    JOIN users u ON u.id=a.user_id
   WHERE a.name='ALA Coroner Mail'
     AND (a.sender_name IS NULL OR a.sender_name='')
     AND a.imap_host='imap.forwardemail.net'
     AND a.smtp_host='smtp.forwardemail.net'
     AND lower(a.email_address) LIKE '%@alacoroner.org'
     AND lower(a.auth_user)=lower(a.email_address)
)
UPDATE email_accounts a
   SET name=f.full_name, sender_name=f.full_name
  FROM to_fix f WHERE a.id=f.id
    AND length(f.full_name) BETWEEN 3 AND 160;
COMMIT;
