# Bundled UI fonts

These fonts are served locally so opening a desktop window does not depend on
Google Fonts responding. `src/fonts.css` preserves the original Google Fonts
CSS descriptors, including weights, italics, Unicode ranges, and
`font-display: swap`; the unchanged font files retain their variable axes.
The browser downloads only the faces and subsets used by the page.

| Family | Google Fonts version | License |
| --- | --- | --- |
| DM Sans | v17 | [SIL OFL 1.1](dmsans/OFL.txt) |
| Fraunces | v38 | [SIL OFL 1.1](fraunces/OFL.txt) |
| Lora | v37 | [SIL OFL 1.1](lora/OFL.txt) |
| Playfair Display | v40 | [SIL OFL 1.1](playfairdisplay/OFL.txt) |

The WOFF2 files are unmodified copies distributed by Google Fonts. These fonts
retain their own licenses; the application's MIT license does not replace them.
Each family's `OFL.txt` contains its upstream copyright notice and full license.
The OFL permits bundling and redistributing the fonts with software when those
notices and licenses are included. It prohibits selling the fonts on their own
and restricts the use of reserved font names for modified versions.

Retrieved on 2026-09-05 from the application's existing [Google Fonts CSS
request](https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Playfair+Display:wght@400;700&family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&display=swap).
[sources.json](sources.json) records each font and license's upstream URL and
SHA-256 checksum. Duplicate CSS faces share a single font file.

Vite copies this directory, including the licenses, into both `dist/fonts/` and
`dist-player/fonts/`. The desktop bundle includes `dist/` and `public/`; the npm
package includes `dist/` and `public/fonts/` so production and development
serving both have the fonts. No font download is needed at build or runtime.

When updating, preserve the licenses and provenance, use a new versioned filename
for changed font bytes, and keep startup HTML free of remote font stylesheets.
