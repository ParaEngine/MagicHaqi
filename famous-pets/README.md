# Famous Pets

Famous pet data is stored in `index.json`. Invite links reference a pet by its `id` in that file:

```text
MagicHaqi.html?petId=famous-pets/petID
```

When `petId` starts with `famous-pets/`, the game first looks for a matching `id` in `index.json`. If no entry is found, it falls back to loading the path as an actual pet JSON file. If both lookups fail, the invite link fails.

To add or update a famous pet, edit `index.json` and make sure the invite URL uses the same `id` value.

Each entry uses the same public pet fields that the rare-pets list and invite preview need. Image paths may be absolute URLs, data URLs, or paths relative to this folder.

```json
[
  {
    "id": "partner_pet_id",
    "name": "Partner Pet Name",
    "dna": "ABCDEFGHJKLMNPQRST",
    "imageSheetUrl": "partner_pet_id/sheet.png",
    "traits": {
      "element": "天空",
      "species": "蜜糖蜜蜂",
      "color": "薄荷绿",
      "eyes": "紫水晶眼睛",
      "accessory": "挂着小铃铛",
      "elementalAttribute": "暗"
    },
    "rarity": 64
  }
]
```

The rare-pets tab hides the name and image as `???` / `?` until the user has hatched or otherwise owns a matching famous pet record.

Do not commit protected brand assets here unless the project has permission to distribute them.
