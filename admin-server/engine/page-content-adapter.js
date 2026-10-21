// Optional content-only transformations of the audited original runtime.
// Never changes input files, scene geometry, material parameters or shaders.
const quote=value=>JSON.stringify(value);
function pageAppRules(site={}) {
  const rules=[];
  const add=(id,scope,find,replace,key,active=true)=>rules.push({id,scope,find,replace,count:1,
    optional:true,applicable:active&&typeof site[key]==='string'&&!!site[key]});
  add('page.hero-video','ViewController','"assets/video/reel.mp4"',()=>quote(site.heroVideo),'heroVideo');
  add('page.hero-poster','ViewController','"assets/video/reel-frame.jpg"',()=>quote(site.heroPoster),'heroPoster');
  add('page.reel-video','WorkDetailContent','"assets/video/reel.mp4"',()=>quote(site.heroVideo),'heroVideo');
  add('page.lab-background','HexagonGrid','Utils3D.getTexture("assets/images/lab.gif")',
    ()=>`Utils3D.getTexture(${quote(site.labBackground)})`,'labBackground');
  for(const [name,ref] of [['Home','privacy'],['Join','subscribe'],['About','careers']]) {
    const key='contact'+name+'Text',url='contact'+name+'URL',id='page.contact-'+name.toLowerCase();
    add(id+'-text','ContactUI',new RegExp(`(_innerText: )"(?:[^"\\\\]|\\\\.)*"(, refName: "${ref}")`),
      (_,a,b)=>a+quote(site[key])+b,key);
    add(id+'-glitch','ContactUI',new RegExp(`(_this\\.${ref}\\.setText\\(replaceRandomLetters\\()"(?:[^"\\\\]|\\\\.)*"`),
      (_,a)=>a+quote(site[key]),key);
    add(id+'-a11y','ContactUI',new RegExp(`GLA11y\\.textNode\\(_this\\.${ref}\\.group, "[^"]*"\\)`),
      ()=>`GLA11y.textNode(_this.${ref}.group, ${quote(site[key])})`,key);
    add(id+'-url','ContactUI',new RegExp(`(_this\\.${ref}\\.interact\\(hover, \\(_ => window\\.open\\()"[^"]*"`),
      (_,a)=>a+quote(site[url]),url);
  }
  for(const [name,ref,file] of [['Instagram','ig','ig'],['Linkedin','in','in'],['X','tw','tw']]) {
    const prefix='contact'+name,id='page.social-'+name.toLowerCase();
    add(id+'-url','ContactUI',new RegExp(`(_this\\.${ref}\\.interact\\(hover, \\(_ => window\\.open\\()"[^"]*"`),
      (_,a)=>a+quote(site[prefix+'URL']),prefix+'URL');
    add(id+'-name','ContactUI',new RegExp(`(_this\\.${ref}\\.interact\\([\\s\\S]*?"#", )"[^"]*"`),
      // Legacy removal hides socials without either a lab or independent URL.
      (_,a)=>a+quote(site[prefix+'Text']),prefix+'Text',!!(site.labUrl||site[prefix+'URL']));
    add(id+'-icon','ContactUI',`bg: "assets/images/ui/${file}.png"`,
      ()=>`bg: ${quote(site[prefix+'Icon'])}`,prefix+'Icon');
  }
  add('page.qr-text','ContactUI',/(_innerText: )"(?:[^"\\]|\\.)*"(, refName: "sync")/,
    (_,a,b)=>a+quote(site.contactQrText)+b,'contactQrText');
  add('page.qr-container','ContactUI',
    '_this.ref_MobileSync980 = _this.initClass(MobileSync), _this.ref_MobileSync980.isFragment && _promises.push(_this.wait(_this.ref_MobileSync980, "__ready")), ',
    '!Device.mobile && (_this.ref_MobileSync980 = _this.initClass(QRCode, { size: 110 })), ','contactQrImage');
  add('page.qr-lookup','ContactUI','_this.qrcode = _this.get("MobileSync/qrcode", !0)',
    '_this.qrcode = _this.ref_MobileSync980','contactQrImage');
  add('page.qr-blending','ContactUI','_this.qrcode.glui.shader.blending = Shader.ADDITIVE_BLENDING',
    '_this.qrcode.glui.shader.blending = Shader.NORMAL_BLENDING','contactQrImage');
  add('page.qr-image','QRCode',/let url = [\s\S]*?_context\.drawImage\(qrCode, 0, 0\)/,
    ()=>`const image = new Image(); image.crossOrigin = "anonymous"; await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("二维码图片加载失败")); image.src = Assets.getPath(${quote(site.contactQrImage)}); }); _context.filter = "none"; _context.drawImage(image, 0, 0, _params.size, _params.size)`,'contactQrImage');
  return rules;
}
module.exports={pageAppRules};
