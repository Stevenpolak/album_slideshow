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
  assert.equal(editor._data().photo_controls, true);
  let saved;
  editor.dispatchEvent = event => { saved = event.detail.config; };
  editor._valueChanged({ stopPropagation() {}, detail: { value: editor._data() } });
  assert.equal(saved.photo_controls, true);
  editor._valueChanged({ stopPropagation() {}, detail: { value: { ...editor._data(), photo_controls: false } } });
  assert.equal(saved.photo_controls, undefined);
});