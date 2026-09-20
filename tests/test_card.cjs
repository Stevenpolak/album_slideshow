const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const filename = path.join(__dirname, "../custom_components/album_slideshow/www/album-slideshow-card.js");
const source = fs.readFileSync(filename, "utf8");
const context = vm.createContext({ console });
vm.runInContext(source.slice(0, source.indexOf("\ndefineAlbumSlideshowCards();")), context);
const PhotoControls = vm.runInContext("PhotoControls", context);
const Card = vm.runInContext("createAlbumSlideshowCardClass(class {})", context);
const PhotoControlsReveal = vm.runInContext("PhotoControlsReveal", context);

function revealFixture() {
  let clock = 0;
  let nextTimer = 0;
  const timers = new Map();
  context.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { at: clock + delay, callback }); return id; };
  context.clearTimeout = id => timers.delete(id);
  const advance = milliseconds => {
    const until = clock + milliseconds;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((first, second) => first[1].at - second[1].at)[0];
      if (!next) break;
      clock = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    clock = until;
  };
  const ownerDocument = new EventTarget();
  const card = new EventTarget();
  card.ownerDocument = ownerDocument;
  card.keyboardFocused = false;
  card.matches = () => card.keyboardFocused;
  card.focus = () => { card.keyboardFocused = true; };
  const container = new EventTarget();
  const button = { focus() { container.keyboardFocused = true; } };
  container.shadowRoot = { querySelector: selector => selector === ":focus-visible" ? container.keyboardFocused && button : button };
  const controls = { active: false, close() { this.active = false; } };
  let resumes = 0;
  const reveal = new PhotoControlsReveal(card, container, controls, () => { resumes += 1; });
  const fire = (type, properties = {}, target = card, path = [card]) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerType: "touch", pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY: 0, detail: 1, ...properties });
    event.composedPath = () => path;
    target.dispatchEvent(event);
    return event;
  };
  return { card, container, controls, reveal, ownerDocument, fire, advance, timers, get resumes() { return resumes; } };
}

test("long press reveals controls without triggering a normal click", () => {
  const fixture = revealFixture();
  fixture.fire("pointerdown");
  fixture.advance(499);
  assert.equal(fixture.container.hidden, true);
  fixture.advance(1);
  assert.equal(fixture.container.hidden, false);
  fixture.fire("pointerup");
  assert.equal(fixture.fire("click").defaultPrevented, true);
  fixture.fire("pointerdown");
  fixture.fire("pointerup");
  assert.equal(fixture.fire("click").defaultPrevented, false);
  fixture.reveal.dispose();
});

test("short taps, scrolling, and canceled pointers do not reveal controls", () => {
  for (const cancel of ["pointerup", "pointercancel", "pointerleave", "pointermove"]) {
    const fixture = revealFixture();
    fixture.fire("pointerdown");
    fixture.advance(200);
    fixture.fire(cancel, { clientX: 30 });
    fixture.advance(600);
    assert.equal(fixture.container.hidden, true, cancel);
    assert.equal(fixture.reveal.holding, false, cancel);
    assert.equal(fixture.fire("click").defaultPrevented, false, cancel);
    fixture.reveal.dispose();
  }
});

test("canceling a prolonged hold restarts the dismissal timer", () => {
  const fixture = revealFixture();
  fixture.fire("pointerdown");
  fixture.advance(6000);
  assert.equal(fixture.container.hidden, false);
  fixture.fire("pointercancel");
  fixture.advance(5000);
  assert.equal(fixture.container.hidden, true);
  fixture.reveal.dispose();
});

test("a later right-click is not suppressed by an earlier long press", () => {
  const fixture = revealFixture();
  fixture.fire("pointerdown");
  fixture.advance(500);
  fixture.fire("pointerup");
  fixture.fire("pointerdown", { pointerType: "mouse", button: 2 });
  const menu = fixture.fire("contextmenu", { pointerType: "mouse", button: 2 });
  assert.equal(menu.defaultPrevented, false);
  fixture.reveal.dispose();
});

test("desktop hover reveals controls and inactivity resumes the slideshow", () => {
  const fixture = revealFixture();
  fixture.fire("pointerenter", { pointerType: "mouse" });
  assert.equal(fixture.container.hidden, false);
  fixture.advance(4999);
  assert.equal(fixture.reveal.holding, true);
  fixture.advance(1);
  assert.equal(fixture.container.hidden, true);
  assert.equal(fixture.resumes, 1);
  fixture.reveal.dispose();
});

test("mouse hover-out immediately hides controls and resumes the slideshow", () => {
  const fixture = revealFixture();
  fixture.fire("pointerenter", { pointerType: "mouse" });
  assert.equal(fixture.container.hidden, false);
  fixture.fire("pointerleave", { pointerType: "mouse" });
  assert.equal(fixture.container.hidden, true);
  assert.equal(fixture.reveal.holding, false);
  assert.equal(fixture.resumes, 1);
  assert.equal(fixture.timers.size, 0);
  fixture.fire("pointerenter", { pointerType: "mouse" });
  assert.equal(fixture.container.hidden, false);
  fixture.fire("pointerleave", { pointerType: "mouse" });
  assert.equal(fixture.container.hidden, true);
  assert.equal(fixture.resumes, 2);
  fixture.advance(5000);
  assert.equal(fixture.resumes, 2);
  fixture.reveal.dispose();
});

test("touch pointerleave preserves long-press controls until the idle timeout", () => {
  const fixture = revealFixture();
  fixture.fire("pointerdown");
  fixture.advance(500);
  fixture.fire("pointerup");
  fixture.fire("pointerleave", { pointerType: "touch" });
  assert.equal(fixture.container.hidden, false);
  fixture.advance(4999);
  assert.equal(fixture.container.hidden, false);
  fixture.advance(1);
  assert.equal(fixture.container.hidden, true);
  assert.equal(fixture.resumes, 1);
  fixture.reveal.dispose();
});

test("mouse hover-out keeps controls open for a dialog or active action", () => {
  const fixture = revealFixture();
  fixture.fire("pointerenter", { pointerType: "mouse" });
  fixture.controls.active = true;
  fixture.fire("pointerleave", { pointerType: "mouse" });
  fixture.advance(6000);
  assert.equal(fixture.container.hidden, false);
  assert.equal(fixture.resumes, 0);
  fixture.controls.active = false;
  fixture.reveal.activity();
  fixture.advance(5000);
  assert.equal(fixture.container.hidden, true);
  fixture.reveal.dispose();
});

test("mouse hover-out does not remove keyboard-focused controls", () => {
  for (const focused of ["card", "container"]) {
    const fixture = revealFixture();
    fixture.fire("pointerenter", { pointerType: "mouse" });
    fixture[focused].keyboardFocused = true;
    fixture.fire("pointerleave", { pointerType: "mouse" });
    fixture.advance(6000);
    assert.equal(fixture.container.hidden, false, focused);
    assert.equal(fixture.resumes, 0, focused);
    fixture.reveal.dispose();
  }
});

test("open dialogs and active actions prevent automatic dismissal", () => {
  const fixture = revealFixture();
  fixture.reveal.show();
  fixture.controls.active = true;
  fixture.advance(6000);
  fixture.fire("pointerdown", {}, fixture.ownerDocument, []);
  assert.equal(fixture.container.hidden, false);
  fixture.controls.active = false;
  fixture.reveal.activity();
  fixture.advance(5000);
  assert.equal(fixture.container.hidden, true);
  fixture.reveal.dispose();
});

test("keyboard focus reveals controls and Escape dismisses them", () => {
  const fixture = revealFixture();
  fixture.card.keyboardFocused = true;
  fixture.fire("focusin");
  fixture.advance(6000);
  assert.equal(fixture.container.hidden, false);
  assert.equal(fixture.fire("keydown", { key: "Escape" }).defaultPrevented, true);
  assert.equal(fixture.container.hidden, true);
  fixture.reveal.dispose();
});

test("keyboard activation focuses the toolbar and blur allows dismissal", () => {
  for (const key of ["Enter", " "]) {
    const fixture = revealFixture();
    assert.equal(fixture.fire("keydown", { key }).defaultPrevented, true);
    assert.equal(fixture.container.hidden, false);
    assert.equal(fixture.container.keyboardFocused, true);
    fixture.advance(5000);
    assert.equal(fixture.container.hidden, false);
    fixture.container.keyboardFocused = false;
    fixture.fire("focusout");
    fixture.advance(5000);
    assert.equal(fixture.container.hidden, true);
    fixture.reveal.dispose();
  }
});

test("secondary pointers and right-clicks cannot trigger a long press", () => {
  for (const properties of [{ isPrimary: false }, { button: 2, pointerType: "mouse" }]) {
    const fixture = revealFixture();
    fixture.fire("pointerdown");
    fixture.fire("pointerdown", properties);
    fixture.advance(1000);
    assert.equal(fixture.container.hidden, true);
    fixture.reveal.dispose();
  }
});

test("outside clicks dismiss controls and disposal cancels pending gestures", () => {
  const fixture = revealFixture();
  fixture.reveal.show();
  fixture.fire("pointerdown", {}, fixture.ownerDocument, []);
  assert.equal(fixture.container.hidden, true);
  fixture.fire("pointerdown");
  fixture.reveal.dispose();
  fixture.advance(1000);
  fixture.fire("pointerenter", { pointerType: "mouse" });
  assert.equal(fixture.container.hidden, true);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.reveal.holding, false);
});

test("the photo controls host respects the opt-in visibility toggle", () => {
  assert.match(source, /:host\(\[hidden\]\)\s*\{\s*display:\s*none\s*!important/);
});

test("photo actions send captured IDs and the selected entry", async () => {
  const calls = [];
  const controls = Object.create(PhotoControls.prototype);
  controls._state = { entryId: "new-entry" };
  controls._getHass = () => ({ callWS: async (request) => { calls.push(request); return {}; } });
  await controls._call("hide_photo", { photo_ids: ["displayed-photo"] }, "captured-entry");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    type: "call_service", domain: "album_slideshow", service: "hide_photo",
    service_data: { photo_ids: ["displayed-photo"], entry_id: "captured-entry" },
  }]);
});

test("hidden-photo lists request a service response on demand", async () => {
  let request;
  const controls = Object.create(PhotoControls.prototype);
  controls._state = { entryId: "test" };
  controls._getHass = () => ({ callWS: async (value) => {
    request = value;
    return { response: { total: 0, photos: [] } };
  } });
  const result = await controls._call("list_hidden_photos", { offset: 25, limit: 25 });
  assert.equal(request.return_response, true);
  assert.equal(request.service_data.offset, 25);
  assert.equal(result.total, 0);
});

test("photo actions cannot run without a config entry", async () => {
  const controls = Object.create(PhotoControls.prototype);
  controls._state = {};
  await assert.rejects(controls._call("hide_photo"), /does not support/);
});

test("paired hide choices retain IDs when the slideshow advances", () => {
  const controls = Object.create(PhotoControls.prototype);
  controls._state = { entryId: "test", photoIds: ["left", "right"], orientation: "horizontal" };
  const buttons = [];
  const calls = [];
  controls._open = () => ({ appendChild(button) { buttons.push(button); } });
  controls._button = (label, icon, action) => ({ label, action });
  controls._run = (...args) => calls.push(args);
  controls._hide();
  controls._state = { entryId: "other", photoIds: ["new-photo"] };
  buttons[1].action();
  assert.equal(buttons[1].label, "Hide right photo");
  assert.equal(JSON.stringify(calls), JSON.stringify([["hide_photo", { photo_ids: ["right"] }, "test"]]));
});

test("exclusion updates override tap-pause and empty the display", () => {
  const card = Object.create(Card.prototype);
  card._config = { entity: "camera.test" };
  card._hiddenRevision = 0;
  card._holdSwapsUntil = Infinity;
  card._hass = { states: { "camera.test": { attributes: { hidden_revision: 1, displayed_photo_ids: [], empty_reason: "all_hidden" } } } };
  let clears = 0;
  let placeholder;
  card._clearDisplayedPhotos = () => { clears += 1; card._holdSwapsUntil = 0; };
  card._setPlaceholder = (value) => { placeholder = value; };
  card._maybeSwap();
  assert.ok(clears > 0);
  assert.equal(card._holdSwapsUntil, 0);
  assert.equal(placeholder, "All photos hidden");
});

test("a replacement frame clears the preparing placeholder after hiding", () => {
  const requests = [];
  const elements = new Map();
  const makeElement = () => ({
    src: "",
    classList: { add() {}, remove() {} },
    removeAttribute(name) { if (name === "src") this.src = ""; },
    replaceChildren() {},
    appendChild(element) { elements.set(element.id, element); },
    remove() { elements.delete(this.id); },
  });
  for (const id of ["a", "b", "blur-a", "blur-b", "captions", "stage"]) {
    elements.set(id, makeElement());
  }
  context.document = { createElement: makeElement };
  context.Image = class { constructor() { requests.push(this); } };
  const card = Object.create(Card.prototype);
  card._config = { entity: "camera.test", fit: "contain", transition: "none" };
  card.shadowRoot = { getElementById: id => elements.get(id) };
  card._hiddenRevision = 0;
  card._loadGeneration = 0;
  card._lastFrameId = 1;
  card._lastEntityPicture = "/camera.jpg?frame=1";
  card._displayedPhotoIds = ["hidden-photo"];
  card._showing = "a";
  card._holdSwapsUntil = Infinity;
  elements.get("a").src = card._lastEntityPicture;
  const attributes = {
    frame_id: 1,
    hidden_revision: 1,
    displayed_photo_ids: [],
    entity_picture: "/camera.jpg?frame=1",
  };
  card._hass = { states: { "camera.test": { attributes } } };
  card._maybeSwap();
  assert.equal(elements.get("placeholder").textContent, "Preparing next photo...");
  assert.equal(elements.get("a").src, "");
  attributes.frame_id = 2;
  attributes.entity_picture = "/camera.jpg?frame=2";
  card._maybeSwap();
  assert.equal(requests.length, 0);
  attributes.frame_id = 3;
  attributes.displayed_photo_ids = ["replacement-photo"];
  attributes.entity_picture = "/camera.jpg?frame=3";
  card._maybeSwap();
  assert.equal(requests.length, 1);
  requests[0].onload();
  assert.equal(elements.has("placeholder"), false);
  assert.equal(elements.get("a").src, "/camera.jpg?frame=3");
  assert.equal(JSON.stringify(card._displayedPhotoIds), '["replacement-photo"]');
});

test("old image requests cannot reveal a frame after exclusion invalidation", () => {
  const requests = [];
  context.Image = class { constructor() { requests.push(this); } };
  const card = Object.create(Card.prototype);
  card._config = { entity: "camera.test" };
  card._loadGeneration = 0;
  card._hass = { states: { "camera.test": { attributes: { frame_id: 2, hidden_revision: 0 } } } };
  let swaps = 0;
  card._performSwap = () => { swaps += 1; };
  card._loadAndSwap("/old.jpg", "contain", false, null, { entityId: "camera.test", frameId: 2, hiddenRevision: 0, photoIds: ["old"] });
  card._loadGeneration += 1;
  requests[0].onload();
  assert.equal(swaps, 0);
});

test("visible controls hold the current frame until dismissed", () => {
  const card = Object.create(Card.prototype);
  card._config = { entity: "camera.test", fit: "contain" };
  card._controlsReveal = { holding: true };
  card._displayedPhotoIds = ["current"];
  card._lastFrameId = 1;
  card._hiddenRevision = 0;
  card._hass = { states: { "camera.test": { attributes: { frame_id: 2, hidden_revision: 0, displayed_photo_ids: ["next"], entity_picture: "/next.jpg" } } } };
  let loads = 0;
  card._loadAndSwap = () => { loads += 1; };
  card._maybeSwap();
  assert.equal(loads, 0);
  assert.equal(card._lastFrameId, 1);
  card._controlsReveal.holding = false;
  card._maybeSwap();
  assert.equal(loads, 1);
  assert.equal(card._lastFrameId, 2);
});

test("a pending image cannot change the photo under open controls", () => {
  const requests = [];
  context.Image = class { constructor() { requests.push(this); } };
  const card = Object.create(Card.prototype);
  card._config = { entity: "camera.test" };
  card._loadGeneration = 0;
  card._controlsReveal = { holding: true };
  card._displayedPhotoIds = ["current"];
  card._lastFrameId = 2;
  card._hass = { states: { "camera.test": { attributes: { frame_id: 2 } } } };
  card._performSwap = () => assert.fail("a held photo changed");
  card._loadAndSwap("/next.jpg", "contain", false, null, { entityId: "camera.test", frameId: 2, photoIds: ["next"] });
  requests[0].onload();
  assert.equal(card._lastFrameId, null);
  assert.equal(JSON.stringify(card._displayedPhotoIds), '["current"]');
});

test("exclusions clear a held photo and allow a safe replacement", () => {
  const card = Object.create(Card.prototype);
  card._config = { entity: "camera.test", fit: "contain" };
  card._controlsReveal = { holding: true };
  card._displayedPhotoIds = ["hidden"];
  card._hiddenRevision = 0;
  card._hass = { states: { "camera.test": { attributes: { frame_id: 3, hidden_revision: 1, displayed_photo_ids: ["safe"], entity_picture: "/safe.jpg" } } } };
  let cleared = false;
  let loaded;
  card._clearDisplayedPhotos = () => { cleared = true; card._displayedPhotoIds = []; };
  card._loadAndSwap = (url) => { loaded = url; };
  card._maybeSwap();
  assert.equal(cleared, true);
  assert.equal(loaded, "/safe.jpg?_frame=3");
});

test("a frame change during image loading retries rather than using mismatched IDs", () => {
  const requests = [];
  context.Image = class { constructor() { requests.push(this); } };
  const card = Object.create(Card.prototype);
  card._config = { entity: "camera.test" };
  card._loadGeneration = 0;
  card._hass = { states: { "camera.test": { attributes: { frame_id: 3, hidden_revision: 0 } } } };
  let retries = 0;
  card._maybeSwap = () => { retries += 1; };
  card._performSwap = () => assert.fail("stale image was shown");
  card._loadAndSwap("/old.jpg", "contain", false, null, { entityId: "camera.test", frameId: 2, hiddenRevision: 0, photoIds: ["old"] });
  requests[0].onload();
  assert.equal(retries, 1);
});

test("older cameras without frame IDs still display images", () => {
  const requests = [];
  context.Image = class { constructor() { requests.push(this); } };
  const card = Object.create(Card.prototype);
  card._config = { entity: "camera.test" };
  card._loadGeneration = 0;
  card._hass = { states: { "camera.test": { attributes: {} } } };
  let swaps = 0;
  card._performSwap = () => { swaps += 1; };
  card._loadAndSwap("/legacy.jpg", "contain", false, null, { entityId: "camera.test", frameId: null, photoIds: [] });
  requests[0].onload();
  assert.equal(swaps, 1);
});

test("the visual editor round-trips the optional photo controls setting", () => {
  context.CustomEvent = class {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  };
  const Editor = vm.runInContext("createAlbumSlideshowCardEditorClass(class { attachShadow() {} })", context);
  const editor = new Editor();
  editor.setConfig({ entity: "camera.test", photo_controls: true });
  const interaction = editor._schema().find(section => section.title === "Interaction");
  assert.ok(interaction.schema.find(field => field.name === "photo_controls"));
  assert.equal(editor._data().photo_controls, "always");
  let saved;
  editor.dispatchEvent = event => { saved = event.detail.config; };
  editor._valueChanged({ stopPropagation() {}, detail: { value: editor._data() } });
  assert.equal(saved.photo_controls, true);
  editor._valueChanged({ stopPropagation() {}, detail: { value: { ...editor._data(), photo_controls: false } } });
  assert.equal(saved.photo_controls, undefined);
});

test("photo control modes preserve legacy boolean settings", () => {
  const settings = [
    [undefined, "off"], [false, "off"], [true, "always"],
    ["off", "off"], ["always", "always"], ["on_demand", "on_demand"],
  ];
  for (const [value, expected] of settings) {
    const card = Object.create(Card.prototype);
    card.setConfig({ entity: "camera.test", photo_controls: value });
    assert.equal(card._config.photo_controls, expected);
  }
  const card = Object.create(Card.prototype);
  assert.throws(() => card.setConfig({ entity: "camera.test", photo_controls: "invalid" }), /unknown photo controls mode/);
});

test("the editor offers and serializes on-demand controls", () => {
  const Editor = vm.runInContext("createAlbumSlideshowCardEditorClass(class { attachShadow() {} })", context);
  const editor = new Editor();
  editor.setConfig({ entity: "camera.test", photo_controls: "on_demand" });
  const interaction = editor._schema().find(section => section.title === "Interaction");
  const field = interaction.schema.find(field => field.name === "photo_controls");
  assert.equal(JSON.stringify(field.selector.select.options.map(option => option.value)), '["off","on_demand","always"]');
  assert.equal(editor._data().photo_controls, "on_demand");
  let saved;
  editor.dispatchEvent = event => { saved = event.detail.config; };
  editor._valueChanged({ stopPropagation() {}, detail: { value: editor._data() } });
  assert.equal(saved.photo_controls, "on_demand");
  editor._valueChanged({ stopPropagation() {}, detail: { value: { ...editor._data(), photo_controls: "off" } } });
  assert.equal(saved.photo_controls, undefined);
});