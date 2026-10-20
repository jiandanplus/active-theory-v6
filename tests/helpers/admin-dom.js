// Small observable DOM fixture. Modules execute unchanged; this is not a browser assertion.
module.exports = function adminDOM() {
  const document = {activeElement: null, listeners: new Map()};
  class Element {
    constructor(tag) {this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.value = ''; this.disabled = false; this.textContent = ''; this.classList = {add() {}, toggle() {}};}
    get isConnected() {return this === document.body || !!this.parent?.isConnected;}
    append(...children) {for (const child of children) {child.parent = this; this.children.push(child);}}
    replaceChildren(...children) {for (const child of this.children) child.parent = null; this.children = []; this.append(...children);}
    setAttribute(key, value) {this.attributes[key] = value;}
    getAttribute(key) {return this.attributes[key];}
    removeAttribute(key) {delete this.attributes[key];}
    addEventListener(type, listener) {(this.listeners[type] ||= []).push(listener);}
    async dispatch(type, extra = {}) {for (const listener of this.listeners[type] || []) await listener({preventDefault() {}, target: this, ...extra});}
    focus() {document.activeElement = this; for (const listener of document.listeners.get('focusin') || []) listener({target: this});}
    closest(tag) {return this.tagName.toLowerCase() === tag ? this : this.parent?.closest(tag);}
    remove() {if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null;}
    showModal() {this.open = true;}
    close() {this.open = false; return this.dispatch('close');}
    scrollIntoView() {}
  }
  document.body = new Element('body');
  document.activeElement = document.body;
  const walk = element => [element, ...element.children.flatMap(walk)];
  document.createElement = tag => new Element(tag);
  document.getElementById = id => walk(document.body).find(element => element.id === id);
  document.querySelectorAll = selector => walk(document.body).filter(element => selector === '[data-busy-action]' ? element.dataset.busyAction : selector === '[data-section]' ? element.dataset.section : selector.startsWith('[data-section=') ? element.dataset.section === selector.match(/"(.*?)"/)[1] : false);
  document.querySelector = selector => document.querySelectorAll(selector)[0];
  document.addEventListener = (type, fn) => {if (!document.listeners.has(type)) document.listeners.set(type, new Set()); document.listeners.get(type).add(fn);};
  document.removeEventListener = (type, fn) => document.listeners.get(type)?.delete(fn);
  for (const id of ['app', 'notice']) {const element = new Element('div'); element.id = id; document.body.append(element);}
  return {document, walk: () => walk(document.body)};
};
