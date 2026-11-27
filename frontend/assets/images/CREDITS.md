# Image credits & replacement guide

The food photographs in this demo were downloaded from **Wikimedia Commons** for prototype use. They remain the property of their original photographers and are subject to the license on each Commons file page (commonly CC BY, CC BY-SA, or public domain).

The original file-page metadata was not kept when the images were downloaded, so the exact author/license pair for each file cannot be listed here. **Before using this site publicly or commercially, verify the source and license of each photo, add the required attribution, or replace the demo photos with your own photography.**

Useful Wikimedia Commons starting points:

- [Korean fried chicken](https://commons.wikimedia.org/wiki/Category:Korean_fried_chicken)
- [Tteokbokki](https://commons.wikimedia.org/wiki/Category:Tteokbokki)
- [Kimbap](https://commons.wikimedia.org/wiki/Category:Kimbap)
- [French fries with cheese](https://commons.wikimedia.org/wiki/Category:Cheese_fries)
- [Samyang noodles](https://commons.wikimedia.org/wiki/Category:Samyang_Foods)
- [Philippine breakfast dishes](https://commons.wikimedia.org/wiki/Category:Breakfast_foods_of_the_Philippines)

## Files in this folder

| File | Used for |
| --- | --- |
| `logo.svg` → `logokrave.jpg` | Brand mark (photo cropped to a circle in the UI) |
| `wings.jpg` | Hero image, 6pcs flavored wings |
| `wings-juicy.jpg` | 6pcs plain wings |
| `wings-cheese.jpg` | 20pcs Pops |
| `wings-banban.jpg` | Shared chicken trays / admin login backdrop |
| `tteokbokki-2.jpg` | Spicy tteokbokki rice cake |
| `tteokbokki.jpg` | Spicy tteokbokki fish cake and tteokbokki tray |
| `samyang-2.jpg` | Cheesy Samyang and Samyang Overload |
| `samyang.jpg` | Alternate Samyang photo |
| `kimbap.jpg` | Cheese Kimbap 10pcs |
| `kimbap-2.jpg` | Alternate kimbap photo |
| `cheesy-fries.jpg` | Cheesy fries |
| `bilao.jpg` | Cheese kimbap bilao |
| `silog-pork.jpg` | Porkchop and liempo silog |
| `silog-chicken.jpg` | Chick silog |

## How to replace a photo

1. Drop the new photo into `frontend/assets/images/`.
2. Open `frontend/js/images.js` and point the matching key at the new file.
3. Or, sign in to `/admin` → **Menu studio** → edit a dish → choose **Custom image URL** and paste a path or full `https://` URL.

No menu or pricing logic lives in `images.js`, so photos can be changed without touching the app.
