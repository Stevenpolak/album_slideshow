# Card Guide

[Overview](../README.md) | [Provider Setup](provider-setup.md) | [Reference](reference.md)

- [Add the card](#add-the-card)
- [Hide photos and use the toolbar](#hide-photos-from-a-slideshow)
- [Full YAML options](#full-options)
- [Transitions and captions](#transitions-and-captions)

## Add the Card

The integration ships with a custom Lovelace card that does the slide-to-slide
transition entirely in the browser. The server renders one still per slide
change; the card handles transitions in CSS.

The card is registered automatically when the integration loads; you do **not**
need to add it as a HACS frontend repository or configure a Lovelace resource
manually. After installing or upgrading, hard-refresh the dashboard once
(Ctrl+Shift+R) so the browser picks up the script.

A visual editor is available: pick **Album Slideshow** from the card picker
in Lovelace and select your slideshow camera.

### Minimal Example

```yaml
type: custom:album-slideshow-card
entity: camera.album_slideshow_living_room
```

Use your own camera entity ID in place of the example.

## Hide Photos From a Slideshow

Hide photos from the ambient display without deleting, archiving, or changing
anything in the source library. Exclusions belong to **one configured slideshow**,
persist across restarts and album refreshes, and apply to every card using that
slideshow's camera. Other configured slideshows are unaffected.

### Toolbar Modes

In the card editor, use the navigation, pause, and photo-management controls
below the form. For controls on the displayed card, choose
**Interaction > Photo controls**:

| Mode | Behavior |
|------|----------|
| **Off** (default) | No controls on the displayed card; they remain available in the editor |
| **On demand** | Hold the photo for half a second to reveal the toolbar; desktop hover or keyboard focus also reveals it |
| **Always** | Keep the toolbar visible |

The toolbar groups **Previous**, **Pause/Resume**, and **Next** separately from
**Hide**, **Undo hide**, and **Hidden photos**. Previous is disabled when no earlier
frame is cached. Previous/Next update the displayed photo even while the toolbar
is holding it, and still work while the slideshow is paused. Pause/Resume controls
the slideshow's existing pause switch, so it affects all cards using that camera;
the icon follows the actual Home Assistant state. **Refresh album** stays in the
editor's Actions section.

With **On demand**, the displayed photo stays steady while choosing an action.
This holds only that card's display; other cards continue normally unless you
use **Pause/Resume** to pause the slideshow itself.
The toolbar dismisses immediately when the mouse leaves the card. It also dismisses
after five seconds of inactivity, a click outside the card, or Escape.
It stays open while a dialog or action is active, or while it has
keyboard focus. Normal taps keep their configured behavior; a long press only
reveals controls and never hides a photo by itself. Scrolling cancels a pending
long press. Exclusion updates can still clear a held photo immediately.

For YAML, use `photo_controls: off`, `on_demand`, or `always`. Existing
`photo_controls: true` settings still mean Always, and `false` still means Off.
Paired slides offer explicit **left/right** or **top/bottom** choices, plus
**Hide both photos**.

### Undo and Restore

**Undo hide** restores the last hide action, including both photos if they were
hidden together. **Hidden photos** opens a paginated list where individual photos
can be restored. **Restore all** requires confirmation in the card. Hidden photos
remain restorable even when they are no longer in the source album.

### Replacement Frames

Hiding or restoring clears previous-frame history and removes unsafe preloaded
frames, so navigation cannot bring back hidden photos. Safe rendered frames are
reused immediately and the upcoming buffer is refilled in the background. If every
ready pair includes the hidden photo, the surviving half can be reused as a single
photo without fetching its source again. That replacement retains the pair's crop
and detail until a normal full-source frame is shown. If no safe cached frame or
half is available, preparing a replacement still requires a new render. Downloads
from another slideshow no longer block hide/restore behind the shared
image-processing lock; image-processing jobs remain serialized across albums.

Hiding the last eligible photo clears the display;
undo and management controls remain available. The **Hidden photos** sensor shows
the exclusion count without exposing the full list in entity history.

### Storage and Photo Identity

Exclusions are loaded before the slideshow starts. If they cannot be loaded,
setup fails instead of displaying photos without applying the hidden list. A
failed save leaves the existing exclusions unchanged. Check **Settings > System >
Logs** for the error and retry after resolving the storage problem.

Photo IDs come from the source, not filenames or expiring download URLs. Local
files use normalized full paths: renaming or moving a file changes its identity.
Replacing a source asset with a new ID also makes it a new photo. A photo without
a usable ID cannot be hidden; refresh an older cached album to obtain IDs. Once
a slideshow has exclusions, unidentified photos are skipped rather than risk
redisplaying a hidden photo.

For button entities, ID-based actions, and the hidden-list response, see the
[automation reference](reference.md#automation-actions).

## Full Options

```yaml
type: custom:album-slideshow-card
entity: camera.album_slideshow_living_room
transition: random          # random | none | fade | slide-left
                            #   | slide-right | slide-up | slide-down
                            #   | wipe-left | wipe-right | zoom
duration: 800               # ms; CSS transition length
easing: ease-in-out         # any CSS timing function (ease, linear, cubic-bezier(...))
aspect_ratio: 16/9          # CSS aspect-ratio value (16/9, 4/3, 1/1, auto)
fit: auto                   # auto | cover | contain
                            # auto inherits the camera's fill_mode (cover / contain / blur)
background: '#000'          # color shown behind contained images
tap_action: none            # none | more-info
photo_controls: on_demand
caption:                    # overlay the photo's date, location and/or description
  show: [date, location]    #   any of: date, location, description (order = display order)
  position: bottom-left     #   top/center/bottom + -left/-center/-right, or center
  date_format: medium       #   medium | full | month_year | year | numeric
                            #     | weekday | relative, or a custom token string
                            #     (YYYY, MMMM, MMM, MM, M, DD, D, dddd, ddd, REL)
  per_image: true           #   caption each half of a portrait pair separately
  color: '#ffffff'          #   any CSS color
  font_size: 14px           #   any CSS size
  font_weight: medium       #   light | normal | medium | semibold | bold
  shadow: true              #   drop shadow for readability on bright photos
```

## Transitions and Captions

- `transition: random` picks a different effect per slide and avoids repeating the previous one. Effects are `none`, `fade`, `slide-left`, `slide-right`, `slide-up`, `slide-down`, `wipe-left`, `wipe-right`, and `zoom`; `duration` and `easing` control the timing.
- `fit: auto` reads the camera's `fill_mode` attribute. `blur` renders the slide as `contain` plus a blurred backdrop layer behind it.
- `photo_controls` defaults to Off. See [Hide Photos From a Slideshow](#hide-photos-from-a-slideshow) for toolbar modes, gestures, paired-photo choices, and restore behavior.
- **Caption overlay:** omit the `caption:` block (or set `show: []`) to disable it. The date comes from `captured_at`; `location` and `description` come from photo metadata. Availability varies by [provider](provider-setup.md#choose-a-provider), and missing fields are skipped. Google Photos supplies dates but no location or description; Media Source supplies none of those fields. On a portrait pair, `per_image: true` anchors each photo's own date/location/description to its half; set it to `false` for a single caption over the whole frame.
- `date_format` accepts a preset name or a custom token string. Presets are locale-aware (they follow your Home Assistant language). Example custom format: `'D MMMM YYYY'` -> `29 July 2023`. The `REL` token inserts relative time, so `'D MMMM YYYY - REL'` -> `29 July 2023 - 3 years ago`.
- Every slide commit increments the camera's `frame_id` attribute. The card cache-busts the camera proxy URL with that value, so the browser refetches a fresh JPEG on every change instead of serving a stale cached image.
- If the entity is unavailable, the card shows a "Camera not ready" placeholder.

See the [rendering reference](reference.md#rendering-options) for fill modes,
orientation pairing, aspect ratios, and transparent dividers.