function noStore(res,{error=false}={}) {
  const privateResponse=String(res.get('Cache-Control')||'').startsWith('private');
  res.removeHeader('ETag');
  res.removeHeader('Last-Modified');
  res.set('Cache-Control',privateResponse?'private, no-store':'no-store');
  if(error)res.set('X-Robots-Tag','noindex, nofollow');
}
function privateDelivery(res) {
  res.set('Cache-Control','private, no-store').set('X-Robots-Tag','noindex, nofollow');
}
function sendDelivery(req,res,{entry,bytes,cacheKind},resolved) {
  if(resolved?.target?.type==='preview')privateDelivery(res);
  const privateResponse=String(res.get('Cache-Control')||'').startsWith('private');
  const revalidate=!privateResponse&&cacheKind==='pinned-program';
  noStore(res);
  res.type(entry.mime).set('X-Content-Type-Options','nosniff');
  if(revalidate) {
    res.set('Cache-Control','public, no-cache, must-revalidate');
    const etag='"'+entry.sha256+'"';
    res.set('ETag',etag);
    const match=String(req.get('if-none-match')||'').split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===etag);
    if(match&&(req.method==='GET'||req.method==='HEAD'))return res.status(304).end();
  }
  res.set('Content-Length',String(bytes.length));
  return req.method==='HEAD'?res.end():res.end(bytes);
}
module.exports={sendDelivery,noStore,privateDelivery};
