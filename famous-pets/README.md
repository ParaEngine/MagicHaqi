# Famous Pets

Place partner-provided pet JSON configs in this folder. Invite links can reference them with:

```text
MagicHaqi.html?petId=famous-pets/petID&layout=idle,happy&text=...
```

Each config uses the same pet JSON shape as `pets/<petId>.json`. Image paths may be absolute URLs, data URLs, or paths relative to the JSON file.

Add each public rare pet to `index.json` so it appears under 宠物列表 -> 稀有宠物:

```json
[
  {
    "id": "partner_pet_id",
    "name": "Partner Pet Name",
    "imageSheetUrl": "partner_pet_id/sheet.png",
    "rarity": 64
  }
]
```

The rare-pets tab hides the name and image as `???` / `?` until the user has hatched or otherwise owns a matching famous pet record.

Minimal shape:

```json
{
  "id": "partner_pet_id",
  "name": "Partner Pet Name",
  "stage": "adult",
  "anim": "idle",
  "dna": "ABCDEFGHJKLMNPQRST",
  "bornAt": 0,
  "imageUrl": null,
  "imageSheetUrl": "partner_pet_id/sheet.png"
}
```

Do not commit protected brand assets here unless the project has permission to distribute them.
