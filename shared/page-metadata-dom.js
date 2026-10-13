(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./site-identity'));
  else root.SiteMetadataDOM=factory(root.SiteIdentity);
})(globalThis,function(identity){
  'use strict';
  function applyPageMetadata(document,meta,{preview=false}={}) {
    document.title=meta.title;
    document.documentElement.lang=meta.language;
    for(const node of document.head.querySelectorAll('title,meta[name],meta[property],link[rel]')) {
      const tag=node.tagName.toLowerCase();
      if(tag==='title'||(tag==='meta'&&identity.ownedMeta(node.getAttribute('name')||node.getAttribute('property')))||
        (tag==='link'&&String(node.getAttribute('rel')).toLowerCase().split(/\s+/).includes('canonical'))) node.remove();
    }
    for(const entry of identity.headEntries(meta,{preview})) {
      const node=document.createElement(entry.tag);
      for(const [key,value] of Object.entries(entry.attributes))node.setAttribute(key,value);
      if(entry.text!==undefined)node.textContent=entry.text;
      document.head.appendChild(node);
    }
  }
  return {applyPageMetadata};
});
