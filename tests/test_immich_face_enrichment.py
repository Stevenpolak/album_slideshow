from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from custom_components.album_slideshow import coordinator as c
from custom_components.album_slideshow import immich
from custom_components.album_slideshow.const import (
    CONF_IMMICH_API_KEY,
    CONF_IMMICH_SELECTION_ID,
    CONF_IMMICH_SELECTION_TYPE,
    CONF_IMMICH_URL,
)


def _coordinator(selection_id: str):
    coord = c.AlbumCoordinator.__new__(c.AlbumCoordinator)
    coord.hass = object()
    coord.entry = SimpleNamespace(
        data={
            CONF_IMMICH_URL: "http://immich.test",
            CONF_IMMICH_API_KEY: "secret",
            CONF_IMMICH_SELECTION_TYPE: "composite",
            CONF_IMMICH_SELECTION_ID: selection_id,
        }
    )
    return coord


def _item():
    return c.MediaItem(
        url="http://immich.test/api/assets/a1/thumbnail?size=preview",
        width=1000,
        height=2000,
        mime_type=None,
        filename="portrait.jpg",
        source_id="a1",
    )


def test_immich_enrichment_adds_selected_face_focus(monkeypatch):
    class FakeClient:
        def __init__(self, *_args):
            pass

        async def async_get_asset(self, asset_id):
            assert asset_id == "a1"
            return {"exifInfo": {"description": "Portrait"}}

        async def async_get_faces(self, asset_id):
            assert asset_id == "a1"
            return [
                {
                    "imageWidth": 1000,
                    "imageHeight": 2000,
                    "boundingBoxX1": 100,
                    "boundingBoxY1": 200,
                    "boundingBoxX2": 300,
                    "boundingBoxY2": 600,
                    "person": {"id": "p1", "name": "Selected"},
                }
            ]

    monkeypatch.setattr(immich, "ImmichClient", FakeClient)
    coord = _coordinator('{"albums": [], "people": ["p1"], "favorites": false}')
    item = _item()

    asyncio.run(coord._enrich_immich_item(item))

    assert item.description == "Portrait"
    assert item.focus_x == pytest.approx(0.2)
    assert item.focus_y == pytest.approx(0.2)
    assert item.exif_scanned is True


def test_immich_face_failure_keeps_metadata_and_center_fallback(monkeypatch):
    class FakeClient:
        def __init__(self, *_args):
            pass

        async def async_get_asset(self, _asset_id):
            return {"exifInfo": {"description": "Still available"}}

        async def async_get_faces(self, _asset_id):
            raise PermissionError("face.read missing")

    monkeypatch.setattr(immich, "ImmichClient", FakeClient)
    coord = _coordinator('{"albums": [], "people": ["p1"], "favorites": false}')
    item = _item()

    asyncio.run(coord._enrich_immich_item(item))

    assert item.description == "Still available"
    assert item.focus_x is None
    assert item.focus_y is None
    assert item.exif_scanned is True


def test_immich_album_only_source_does_not_request_faces(monkeypatch):
    class FakeClient:
        def __init__(self, *_args):
            pass

        async def async_get_asset(self, _asset_id):
            return {"exifInfo": {}}

        async def async_get_faces(self, _asset_id):
            raise AssertionError("album-only source must not request faces")

    monkeypatch.setattr(immich, "ImmichClient", FakeClient)
    coord = _coordinator('{"albums": ["a1"], "people": [], "favorites": false}')
    item = _item()

    asyncio.run(coord._enrich_immich_item(item))

    assert item.focus_x is None
    assert item.exif_scanned is True
