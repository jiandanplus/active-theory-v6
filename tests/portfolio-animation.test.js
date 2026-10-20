const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../examples/portfolio/app.js'), 'utf8');

function animationFixture({reducedMotion = false} = {}) {
  function eventTarget() {
    const listeners = new Map();
    return {
      addEventListener(type, listener, options) {
        const entries = listeners.get(type) || [];
        entries.push({listener, once: options?.once});
        listeners.set(type, entries);
      },
      removeEventListener(type, listener) {
        listeners.set(type, (listeners.get(type) || []).filter(entry => entry.listener !== listener));
      },
      dispatch(type, event = {}) {
        for (const entry of [...(listeners.get(type) || [])]) {
          if (entry.once) this.removeEventListener(type, entry.listener);
          entry.listener(event);
        }
      },
      listenerCount(type) {return (listeners.get(type) || []).length;},
    };
  }
  const deleted = [], frames = new Map(), cancelled = [];
  let frameId = 0, draws = 0;
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLE_STRIP: 8,
    createShader(type) {return {type};}, shaderSource() {}, compileShader() {},
    getShaderParameter() {return true;},
    createProgram() {return {kind: 'program'};}, attachShader() {}, linkProgram() {},
    getProgramParameter() {return true;}, useProgram() {},
    createBuffer() {return {kind: 'buffer'};}, bindBuffer() {}, bufferData() {},
    getAttribLocation() {return 0;}, enableVertexAttribArray() {}, vertexAttribPointer() {},
    viewport() {}, getUniformLocation() {return {};}, uniform2f() {}, uniform1f() {},
    drawArrays() {draws++;},
    deleteBuffer(value) {deleted.push(value);},
    deleteProgram(value) {deleted.push(value);},
    deleteShader(value) {deleted.push(value);},
  };
  const button = Object.assign(eventTarget(), {hidden: true, attributes: {},
    setAttribute(name, value) {this.attributes[name] = value;}});
  const canvas = Object.assign(eventTarget(), {clientWidth: 640, clientHeight: 400,
    getContext(type) {assert.equal(type, 'webgl'); return gl;}});
  const visual = {querySelector(selector) {return selector === 'canvas' ? canvas : button;}};
  const document = Object.assign(eventTarget(), {hidden: false,
    querySelector(selector) {assert.equal(selector, '[data-portfolio-visual]'); return visual;}});
  const motion = Object.assign(eventTarget(), {matches: reducedMotion});
  const window = Object.assign(eventTarget(), {matchMedia() {return motion;}});
  vm.runInNewContext(source, {window, document, devicePixelRatio: 1,
    requestAnimationFrame(callback) {frames.set(++frameId, callback); return frameId;},
    cancelAnimationFrame(id) {cancelled.push(id); frames.delete(id);},
  }, {filename: 'examples/portfolio/app.js'});
  return {window, document, motion, button, canvas, frames, cancelled, deleted,
    get draws() {return draws;},
    tick(now = 100) {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      callback(now);
    },
  };
}

test('BFCache pagehide cancels animation frames without releasing reusable WebGL resources', () => {
  const f = animationFixture();
  assert.equal(f.frames.size, 1);
  f.tick();
  assert.equal(f.draws, 1);
  const pending = [...f.frames.keys()][0];
  f.window.dispatch('pagehide', {persisted: true});
  assert.equal(f.frames.size, 0);
  assert.ok(f.cancelled.includes(pending));
  assert.equal(f.button.attributes['aria-pressed'], 'false');
  assert.equal(f.deleted.length, 0);
});

test('BFCache Back restores the wanted animation across repeated navigation cycles', () => {
  const f = animationFixture();
  for (let cycle = 0; cycle < 2; cycle++) {
    f.window.dispatch('pagehide', {persisted: true});
    f.window.dispatch('pageshow', {persisted: true});
    assert.equal(f.frames.size, 1);
    assert.equal(f.button.attributes['aria-pressed'], 'true');
    f.tick(100 + cycle * 100);
  }
  assert.equal(f.draws, 2);
  assert.equal(f.deleted.length, 0);
});

test('a manual pause survives BFCache Back and the play control remains usable', () => {
  const f = animationFixture();
  f.button.dispatch('click');
  assert.equal(f.frames.size, 0);
  f.window.dispatch('pagehide', {persisted: true});
  f.window.dispatch('pageshow', {persisted: true});
  assert.equal(f.frames.size, 0);
  assert.equal(f.button.attributes['aria-pressed'], 'false');
  f.button.dispatch('click');
  assert.equal(f.frames.size, 1);
});

test('nonpersisted pagehide after BFCache permanently cleans resources and subscriptions once', () => {
  const f = animationFixture();
  f.window.dispatch('pagehide', {persisted: true});
  f.window.dispatch('pageshow', {persisted: true});
  assert.equal(f.deleted.length, 0);
  f.window.dispatch('pagehide', {persisted: false});
  assert.equal(f.frames.size, 0);
  assert.equal(f.deleted.length, 4);
  assert.equal(f.motion.listenerCount('change'), 0);
  assert.equal(f.document.listenerCount('visibilitychange'), 0);
  f.window.dispatch('pageshow', {persisted: true});
  f.button.dispatch('click');
  f.window.dispatch('pagehide', {persisted: false});
  assert.equal(f.frames.size, 0);
  assert.equal(f.deleted.length, 4);
});

test('BFCache restoration respects reduced motion and document visibility', () => {
  const reduced = animationFixture({reducedMotion: true});
  reduced.window.dispatch('pagehide', {persisted: true});
  reduced.window.dispatch('pageshow', {persisted: true});
  assert.equal(reduced.frames.size, 0);
  reduced.button.dispatch('click');
  assert.equal(reduced.frames.size, 1);
  const hidden = animationFixture();
  hidden.window.dispatch('pagehide', {persisted: true});
  hidden.document.hidden = true;
  hidden.window.dispatch('pageshow', {persisted: true});
  assert.equal(hidden.frames.size, 0);
  hidden.document.hidden = false;
  hidden.document.dispatch('visibilitychange');
  assert.equal(hidden.frames.size, 1);
});
