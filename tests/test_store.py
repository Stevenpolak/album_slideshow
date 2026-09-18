from __future__ import annotations

import asyncio
from copy import deepcopy

import pytest

from custom_components.album_slideshow import store as store_module


@pytest.fixture
def storage(monkeypatch):
    records = {}

    class FakeStorage:
        def __init__(self, hass, version, key):
            self.key = key

        async def async_load(self):
            return deepcopy(records.get(self.key))

        async def async_save(self, data):
            records[self.key] = deepcopy(data)

    monkeypatch.setattr(store_module, "Store", FakeStorage)
    return records


def test_exclusions_persist_per_entry_and_undo_survives_restart(storage):
    async def run():
        original = store_module.SlideshowStore()
        await original.async_load_hidden_photos(None, "first")
        assert await original.async_set_photos_hidden(["photo-a", "photo-b"], hidden=True)
        restored = store_module.SlideshowStore()
        await restored.async_load_hidden_photos(None, "first")
        other = store_module.SlideshowStore()
        await other.async_load_hidden_photos(None, "second")
        assert restored.hidden_photo_ids == {"photo-a", "photo-b"}
        assert restored.last_hidden_photo_ids == ("photo-a", "photo-b")
        assert restored.hidden_revision == original.hidden_revision == 1
        assert not other.hidden_photo_ids
        assert await restored.async_set_photos_hidden(restored.last_hidden_photo_ids, hidden=False)
        assert not restored.hidden_photo_ids
        assert storage["album_slideshow.first.hidden"] == {"hidden": [], "last_hidden": [], "revision": 2}

    asyncio.run(run())


def test_repeated_hide_is_a_noop_and_preserves_last_action(storage):
    async def run():
        store = store_module.SlideshowStore()
        await store.async_load_hidden_photos(None, "test")
        notifications = []
        store.add_listener(lambda: notifications.append(store.hidden_revision))
        store.last_frame = b"old-photo"
        assert await store.async_set_photos_hidden(["photo-a"], hidden=True)
        assert store.last_frame is None
        assert not await store.async_set_photos_hidden(["photo-a"], hidden=True)
        assert store.last_hidden_photo_ids == ("photo-a",)
        assert notifications == [1]
        assert await store.async_set_photos_hidden(["photo-b"], hidden=True)
        assert await store.async_set_photos_hidden(store.last_hidden_photo_ids, hidden=False)
        assert store.hidden_photo_ids == {"photo-a"}

    asyncio.run(run())


def test_failed_save_leaves_exclusions_and_frame_unchanged(storage, monkeypatch):
    async def run():
        store = store_module.SlideshowStore()
        await store.async_load_hidden_photos(None, "test")
        store.last_frame = b"current-photo"
        notifications = []
        store.add_listener(lambda: notifications.append(True))

        async def fail_save(data):
            raise OSError("Disk unavailable")

        monkeypatch.setattr(store._hidden_storage, "async_save", fail_save)
        with pytest.raises(OSError, match="Disk unavailable"):
            await store.async_set_photos_hidden(["photo-a"], hidden=True)
        assert not store.hidden_photo_ids
        assert not store.last_hidden_photo_ids
        assert store.hidden_revision == 0
        assert store.last_frame == b"current-photo"
        assert not notifications

    asyncio.run(run())


@pytest.mark.parametrize("data", [[], {"hidden": "bad"}, {"hidden": [None]}, {"last_hidden": [""]}, {"revision": -1}])
def test_invalid_storage_is_not_silently_treated_as_empty(storage, data):
    storage["album_slideshow.test.hidden"] = data
    store = store_module.SlideshowStore()
    with pytest.raises(ValueError, match="Invalid hidden-photo"):
        asyncio.run(store.async_load_hidden_photos(None, "test"))


def test_restore_selected_does_not_reset_other_exclusions(storage):
    async def run():
        store = store_module.SlideshowStore()
        await store.async_load_hidden_photos(None, "test")
        await store.async_set_photos_hidden(["photo-a", "photo-b"], hidden=True)
        await store.async_set_photos_hidden(["photo-a"], hidden=False)
        assert store.hidden_photo_ids == {"photo-b"}
        assert store.last_hidden_photo_ids == ("photo-b",)
        await store.async_set_photos_hidden(store.hidden_photo_ids, hidden=False)
        assert not store.hidden_photo_ids

    asyncio.run(run())