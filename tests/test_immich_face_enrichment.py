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


def test_immich_enrichment_adds_weighted_face_boxes(monkeypatch):
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
    # Box normalised to the 1000x2000 image; selected person gets the bonus.
    assert item.faces == [pytest.approx([0.1, 0.1, 0.3, 0.3, 0.04 * immich.SELECTED_FACE_BONUS])]
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
    assert item.faces is None  # unknown, not "no faces"
    assert item.exif_scanned is True


def test_immich_album_only_source_stores_all_faces(monkeypatch):
    class FakeClient:
        def __init__(self, *_args):
            pass

        async def async_get_asset(self, _asset_id):
            return {"exifInfo": {}}

        async def async_get_faces(self, _asset_id):
            return [
                {
                    "imageWidth": 1000,
                    "imageHeight": 2000,
                    "boundingBoxX1": 100,
                    "boundingBoxY1": 200,
                    "boundingBoxX2": 300,
                    "boundingBoxY2": 600,
                    "person": None,
                },
                {
                    "imageWidth": 1000,
                    "imageHeight": 2000,
                    "boundingBoxX1": 500,
                    "boundingBoxY1": 1000,
                    "boundingBoxX2": 700,
                    "boundingBoxY2": 1400,
                    "person": {"id": "someone", "name": "Someone"},
                },
            ]

    monkeypatch.setattr(immich, "ImmichClient", FakeClient)
    coord = _coordinator('{"albums": ["a1"], "people": [], "favorites": false}')
    item = _item()

    asyncio.run(coord._enrich_immich_item(item))

    assert item.faces == [
        pytest.approx([0.1, 0.1, 0.3, 0.3, 0.04]),
        pytest.approx([0.5, 0.5, 0.7, 0.7, 0.04]),
    ]
    assert item.exif_scanned is True
