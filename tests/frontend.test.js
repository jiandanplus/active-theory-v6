const { test } = require("node:test");
const assert = require("node:assert/strict");
test("worker root-relative geometry paths keep one slash and the actual origin", () => {
  const { patchAppSource }=require('../admin-server/frontend');
  const source='this.absolutePath = function (path) { return "old/"+path; };';
  const patched=patchAppSource(source,{site:{},songs:[]});
  const target={};new Function('location',patched).call(target,{origin:'http://localhost:3001'});
  assert.equal(target.absolutePath('/assets/geometry/admin/id.bin'),'http://localhost:3001/assets/geometry/admin/id.bin');
});
test("versioned bridge rewrites CMS and shader requests without embedding secrets", () => {
  const { bridgeSource, patchAppSource } = require("../admin-server/frontend");
  const config = {
    site: { title: "My site", navWork: "作品", navContact: "联系" },
    songs: [],
  };
  const script = bridgeSource(7, config);
  assert.match(script, /api\/site\/7/);
  assert.doesNotThrow(() => new Function(script));
  const source =
    'Class((function ViewController(){ document.title = "AGI旅行者· AGI Voyager"; })), Class((function Main(){}));';
  assert.match(patchAppSource(source, config), /My site/);
});
test("converted models use engine-compatible geometry aliases", () => {
  const { buildUIL } = require("../admin-server/config");
  const result = buildUIL("/nonexistent", {
    scenes: [
      {
        id: "Home",
        fields: [{ key: "logo", type: "geometry", value: "/models/abc.bin" }],
      },
    ],
  });
  assert.equal(result.logo.src, "/assets/geometry/admin/abc.bin");
});
test("patches preserve dollar replacement characters and empty music lists", () => {
  const { patchAppSource } = require("../admin-server/frontend");
  const config = {
    site: {
      title: "$& title",
      navWork: "$& work",
      navContact: "Contact",
      email: "$& email",
    },
    songs: [],
  };
  const source =
    'Class((function ViewController(){ document.title = "AGI旅行者· AGI Voyager"; }));Class((function NavUI(){let x={text: "Work", _type: 1};}));Class((function ContactUI(){let x={_innerText: "old", refName: "email"};})); let SONGS = [{title:"old",src:"x"}];';
  const patched = patchAppSource(source, config);
  assert(patched.includes('"$& title"'));
  assert(patched.includes('"$& work"'));
  assert(patched.includes('"$& email"'));
  assert(patched.includes("let SONGS = [];"));
  assert.doesNotThrow(() => new Function(patched));
});
