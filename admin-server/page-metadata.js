const {headEntries,ownedMeta}=require('../shared/site-identity');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function attribute(tag,name) {
  const match=new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i').exec(tag);
  return match?.[1]??match?.[2]??match?.[3]??'';
}
// This edits the deployment-owned template; it is not an HTML sanitizer.
function renderPageMetadata(html,meta,{preview=false}={}) {
  const entries=headEntries(meta,{preview}).map(entry=>{
    const attrs=Object.entries(entry.attributes).map(([k,v])=>` ${k}="${escape(v)}"`).join('');
    return entry.tag==='title'?`<title>${escape(entry.text)}</title>`:`<${entry.tag}${attrs}>`;
  }).join('\n');
  if(!/<head\b/i.test(html)) throw Error('HTML template requires a head');
  html=html.replace(/<head\b([^>]*)>([\s\S]*?)<\/head\s*>/i,(_,attrs,body)=>{
    body=body.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi,'')
      .replace(/<meta\b[^>]*>/gi,tag=>ownedMeta(attribute(tag,'name')||attribute(tag,'property'))?'':tag)
      .replace(/<link\b[^>]*>/gi,tag=>attribute(tag,'rel').toLowerCase().split(/\s+/).includes('canonical')?'':tag);
    return `<head${attrs}>${entries}\n${body}</head>`;
  });
  return html.replace(/<html\b([^>]*)>/i,(_,attrs)=>`<html${attrs.replace(/\s+lang\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')} lang="${escape(meta.language)}">`);
}
module.exports={renderPageMetadata,ownedMeta};
