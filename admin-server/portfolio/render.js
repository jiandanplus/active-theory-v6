const {escape} = require('../page-metadata');
const styles = require('./styles');

function safeLink(value, {email = false} = {}) {
  if (typeof value !== 'string') return '';
  if (email) return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value) ? 'mailto:' + value : '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function media(value) {
  if (typeof value !== 'string') return '';
  if (/^\/api\/site\/(?:[1-9][0-9]*|preview-[a-f0-9-]+)\/resources\//.test(value)) return value;
  return safeLink(value);
}
function renderPortfolio({config, pathname = '/', target, basic = false, programs = {}, scripts = true}) {
  const site = config.site || {}, projects = config.projects || [];
  const base = basic ? '/basic' : '';
  const route = pathname.replace(/^\/basic(?=\/|$)/, '') || '/';
  const preview = target?.type === 'preview' ? '?preview=' + target.id.slice(8) : '';
  const href = path => (base + (path === '/' ? '' : path) || '/') + preview;
  const isDetail = route.startsWith('/work/');
  const project = isDetail ? projects.find(item => '/work/' + item.slug === route) : null;
  const card = item => {
    const image = media(item.image?.url || item.video?.thumbnail);
    return `<article class="card"><a href="${escape(href('/work/' + item.slug))}">${image ? `<img src="${escape(image)}" alt="${escape(item.name || '')}" loading="lazy" width="640" height="400">` : '<div class="card-art" aria-hidden="true"></div>'}<div class="card-body"><span class="meta">${escape(item.tags || 'PROJECT')}</span><h3>${escape(item.name || '')}</h3><p class="meta">${escape(item.description || '')}</p><span>查看作品 ↗</span></div></a></article>`;
  };
  const contactLink = safeLink(site.emailLink, {email:true});
  const contact = `<section id="contact" class="contact"><div><span class="eyebrow">CONTACT</span><h2>${escape(site.contactTitle || '一起创造新的可能')}</h2><p class="meta">${escape([site.cityLax,site.cityNyc,site.cityAms].filter(Boolean).join(' · '))}</p></div>${contactLink ? `<a href="${escape(contactLink)}">${escape(site.email || site.emailLink)} ↗</a>` : '<p class="meta">期待与你建立联系。</p>'}</section>`;
  let content;
  if (project) {
    const image = media(project.image?.url || project.video?.thumbnail);
    const video = media(project.video?.url);
    const links = [['访问作品',project.projectURL],['阅读案例',project.caseStudyURL]].map(([label,value]) => {
      const link = safeLink(value);
      return link ? `<a class="button" href="${escape(link)}" rel="noopener noreferrer">${label} ↗</a>` : '';
    }).join('');
    content = `<article class="detail"><a class="meta" href="${escape(href('/work'))}">← 全部作品</a><p class="eyebrow">${escape(project.tags || 'PROJECT')}</p><h1>${escape(project.name)}</h1><p class="description">${escape(project.description || '')}</p><p class="meta">${escape(project.clientName || '')}${project.completionDate ? ' · ' + escape(project.completionDate.slice(0,10)) : ''}</p>${image ? `<img class="detail-media" src="${escape(image)}" alt="${escape(project.name)}">` : ''}${video ? `<video class="detail-media" controls preload="metadata"${image ? ` poster="${escape(image)}"` : ''}><source src="${escape(video)}"><a href="${escape(video)}">打开作品视频</a></video>` : ''}<div class="actions">${links}</div></article>${contact}`;
  } else if (route === '/contact') content = `<div class="detail"><h1>保持联系。</h1></div>${contact}`;
  else {
    const hero = route === '/' ? `<div class="hero"><div><span class="eyebrow">INDEPENDENT PORTFOLIO</span><h1>${escape(site.title || '个人主页')}</h1><p class="intro">${escape(site.description || '记录想法，呈现作品，连接新的可能。')}</p><div class="actions"><a class="button primary" href="${escape(href('/work'))}">浏览作品 ↗</a><a class="button" href="${escape(href('/contact'))}">与我联系</a></div></div><div><div class="visual" data-portfolio-visual role="img" aria-label="原创程序化黑洞装饰"><canvas aria-hidden="true"></canvas><button type="button" hidden aria-pressed="false">播放动态效果</button></div><p class="visual-note">EXPLORING LIGHT, SPACE & IDEAS</p></div></div>` : `<div class="detail"><span class="eyebrow">SELECTED WORK</span><h1>想法的形状。</h1><p class="intro">${escape(site.description || '一些探索，一些实践。')}</p></div>`;
    content = `${hero}<section id="work"><div class="section-head"><h2>精选作品</h2><p class="meta">${projects.length.toString().padStart(2,'0')} PROJECTS</p></div>${projects.length ? `<div class="grid">${projects.map(card).join('')}</div>` : '<p class="empty">新的作品正在路上。</p>'}</section>${contact}`;
  }
  const identity = target && scripts ? `<script src="/api/site/${target.id}/identity.js"></script><script src="/api/site/${target.id}/bridge.js"></script>` : '';
  const app = scripts && programs['examples/portfolio/app.js'] ? `<script defer src="${escape(programs['examples/portfolio/app.js'])}"></script>` : '';
  return `<!doctype html><html lang="${escape(site.language || 'zh-CN')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style>${identity}</head><body><a class="skip" href="#main">跳转到主要内容</a><div class="wrap"><header><a class="brand" href="${escape(href('/'))}">${escape(site.title || '个人主页')}</a><nav aria-label="主导航"><a href="${escape(href('/'))}"${route === '/' ? ' aria-current="page"' : ''}>首页</a><a href="${escape(href('/work'))}"${route.startsWith('/work') ? ' aria-current="page"' : ''}>${escape(site.navWork || '作品')}</a><a href="${escape(href('/contact'))}"${route === '/contact' ? ' aria-current="page"' : ''}>${escape(site.navContact || '联系')}</a></nav></header><main id="main" tabindex="-1">${content}</main><footer><span>${escape(site.title || '个人主页')} · 用作品表达</span><a href="${escape((basic ? '/' : '/basic') + preview)}">${basic ? '增强展示' : '普通网页'}</a></footer></div>${app}</body></html>`;
}
module.exports = {renderPortfolio,safeLink};
