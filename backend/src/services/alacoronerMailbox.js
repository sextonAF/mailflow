// Attach a centrally provisioned Forward Email mailbox only after successful
// ALA Coroner ID OIDC login. The bridge never runs from browser-controlled input.
// Existing accounts (even with different credentials) are never overwritten.
import { pool } from './db.js';
import { encrypt } from './encryption.js';
import { NEXT_ACCOUNT_SORT_ORDER } from './accountOrder.js';
const ISSUER='https://id.alacoroner.org/application/o/mailflow/';
const BRIDGE='https://admin.coroner.app/internal/mailflow/mailbox';
const ADDRESS=/^[a-z0-9]+(?:[.-][a-z0-9]+)*@alacoroner\.org$/;
export async function connectManagedMailbox({userId,oidcEmail,oidcUsername,issuer}={}){
  const token=String(process.env.MAILFLOW_BRIDGE_TOKEN||'');
  if(!token||issuer!==ISSUER||typeof oidcEmail!=='string'||!oidcEmail.includes('@')||
     typeof oidcUsername!=='string'||!oidcUsername.trim())return false;
  const response=await fetch(BRIDGE,{method:'POST',redirect:'error',
    signal:AbortSignal.timeout(8000),
    headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify({issuer:ISSUER,oidc_email:oidcEmail,oidc_username:oidcUsername})});
  if(response.status===404||response.status===503)return false; // mailbox not provisioned yet
  if(!response.ok)throw new Error('Central mailbox handoff HTTP '+response.status);
  const data=await response.json();
  if(!ADDRESS.test(data?.address)||typeof data.password!=='string'||data.password.length<16
     ||data.imap_host!=='imap.forwardemail.net'||data.smtp_host!=='smtp.forwardemail.net'
     ||Number(data.imap_port)!==993||Number(data.smtp_port)!==465)
    throw new Error('Invalid Central Admin mailbox response');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[userId,data.address]);
    const existing=await client.query(
      'SELECT id FROM email_accounts WHERE user_id=$1 AND lower(email_address)=lower($2) LIMIT 1',
      [userId,data.address]);
    if(existing.rowCount){await client.query('COMMIT');return false;}
    await client.query(
      `INSERT INTO email_accounts
      (user_id,name,sender_name,email_address,color,protocol,
       imap_host,imap_port,imap_tls,imap_skip_tls_verify,
       smtp_host,smtp_port,smtp_tls,auth_user,auth_pass,smtp_auth_user,smtp_auth_pass,sort_order)
       VALUES ($1,$2,NULL,$3,'#6366f1','imap',
       'imap.forwardemail.net',993,true,false,
       'smtp.forwardemail.net',465,'SSL',$3,$4,$3,$5,${NEXT_ACCOUNT_SORT_ORDER})`,
      [userId,'ALA Coroner Mail',data.address,encrypt(data.password),encrypt(data.password)]
    );
    await client.query('COMMIT');
    return true;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
}
