// Minimal Backblaze B2 client for the browser, shaped like the small slice
// of the Supabase Storage API this project actually uses (upload/remove/list
// under `.storage.from(bucket)`, plus a publicUrl() helper) so builder.html
// and index.html don't need two different code paths.
//
// Uses B2's S3-compatible API with SigV4 request signing (via aws4fetch),
// not B2's native API -- b2_authorize_account has no browser CORS support
// at all (it's designed for server-side use), so calling it directly from
// a static page isn't possible. The S3-compatible endpoint does support
// CORS for signed requests, which is what this relies on.
import { AwsClient } from 'https://cdn.jsdelivr.net/npm/aws4fetch@1/+esm';

function encodePath(path){
  return path.split('/').map(encodeURIComponent).join('/');
}

function parseListXml(xml){
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return [...doc.getElementsByTagName('Contents')].map(node => ({
    name: node.getElementsByTagName('Key')[0]?.textContent || '',
    metadata: { size: parseInt(node.getElementsByTagName('Size')[0]?.textContent || '0', 10) }
  }));
}

export function createB2Client(cfg){
  const client = new AwsClient({
    accessKeyId: cfg.keyId,
    secretAccessKey: cfg.appKey,
    service: 's3',
    region: cfg.region || 'us-west-004'
  });
  const base = `https://${cfg.s3Endpoint}/${cfg.bucketName}`;

  return {
    publicUrl(path){
      return `${cfg.downloadUrl}/file/${cfg.bucketName}/${encodePath(path)}`;
    },
    storage: {
      from(){
        return {
          async upload(path, file){
            try{
              const res = await client.fetch(`${base}/${encodePath(path)}`, {
                method: 'PUT',
                headers: { 'Content-Type': file.type || 'application/octet-stream' },
                body: file
              });
              if(!res.ok){
                const text = await res.text().catch(() => '');
                return { data: null, error: { message: `Upload failed (${res.status}): ${text.slice(0, 200)}` } };
              }
              return { data: { path }, error: null };
            }catch(e){
              return { data: null, error: { message: e.message } };
            }
          },
          async remove(paths){
            try{
              for(const path of paths){
                const res = await client.fetch(`${base}/${encodePath(path)}`, { method: 'DELETE' });
                if(!res.ok && res.status !== 404){
                  const text = await res.text().catch(() => '');
                  return { data: null, error: { message: `Delete failed (${res.status}): ${text.slice(0, 200)}` } };
                }
              }
              return { data: null, error: null };
            }catch(e){
              return { data: null, error: { message: e.message } };
            }
          },
          async list(prefix){
            try{
              const url = `${base}?list-type=2&prefix=${encodeURIComponent((prefix || '') + '/')}&max-keys=1000`;
              const res = await client.fetch(url, { method: 'GET' });
              if(!res.ok){
                const text = await res.text().catch(() => '');
                return { data: null, error: { message: `List failed (${res.status}): ${text.slice(0, 200)}` } };
              }
              const data = parseListXml(await res.text());
              return { data, error: null };
            }catch(e){
              return { data: null, error: { message: e.message } };
            }
          }
        };
      }
    }
  };
}
