# QuestLearn design prototype

Historical design notes. The current app is described in the [project README](../../README.md).

## Design directions

- Option One: original pixel-adventure mockup, preserved as option-one.png.
- Option Two: restrained quest-journal direction, preserved in the option-two-*.png screenshots.
- Pixel-adventure prototype: browser screenshots use pixel-*.png.

## Included screens and interactions

Dashboard with honest new-user state; document/topic setup; simulated uploading/extracting/preparing/ready states; unsupported file and scanned PDF messages; retryable processing failure; library; four-mission learning path; clickable islands; pixel character hop on mission advancement; tutor/summary tabs; suggested questions and local chat preview; sample document source excerpts and mobile source drawer; insufficient-evidence response preview; five-question knowledge check; correct/incorrect feedback; results with separate answer and completion XP; review mistakes; first-attempt accuracy; revision suggestions; and badge progress.

All prototype learning content uses a Python Functions sample, regardless of the entered topic/file. This is stated in setup and throughout the interface. Files are only selected in the browser, not uploaded or extracted. Questions are not sent to AI. No authentication, database, production scoring, or reward protection is claimed. State lasts only for the current React session and resets on refresh. The existing Day 1 API health checker remains at /foundation.

The level formula is floor(total XP / 500) + 1. A first quiz grants 20 XP per correct answer plus 50 XP once for mission completion. Practice repeats preserve first-attempt statistics and grant no extra XP. This is frontend presentation logic only; answer keys are present in the bundle because this is explicitly a design prototype. Production will require private backend keys, deterministic grading and transactional rewards.

## Historical verification

Actually run: seven Vitest/React Testing Library tests passed, TypeScript/Vite production build passed, and two Chrome browser journeys passed at 1440px and 390px widths. Browser journeys verify setup, lessons, quiz, results, progress, reward consistency, practice repeats and no horizontal overflow on the progress screen. Desktop screenshots captured for all six screen groups and mobile dashboard. Scanned/unsupported file states are covered by component tests. Screenshots of dashboard, workspace and mobile dashboard were visually inspected. No production deployment was performed.

## Generated scenery

The prototype scenery is archived as [quest-world-base.png](quest-world-base.png). Its clickable controls and character were separate from the artwork.

Final generation prompt:

Create an original high-quality pixel-art background asset for a cozy educational RPG web app. Wide landscape 16:9 image. NO text, NO UI, NO numbers, NO labels, NO characters, NO logos. Bright blue sky, fluffy pixel clouds, distant floating mountains, small distant fairytale castle, emerald green trees, tiny purple flowers and waterfalls. Four main floating grassy islands with broad clearly visible EMPTY circular stone platforms, linked by a winding walkable stone stepping-block bridge. Composition important: island platform centers roughly at x=15%, y=76%; x=38%, y=60%; x=62%, y=42%; x=85%, y=24%. Platforms rise from lower left to upper right, grass with rocky undersides. Fourth upper right island has a small CLOSED golden treasure chest behind its empty platform. Maintain visual contrast and clean platform surfaces suitable for overlaying clickable mission buttons. Pixelated raster aesthetic with crisp small square pixels, warm cream stone, lavender shadows, lush greenery, atmospheric blue distance. Inspired by cozy original RPG game art, no existing characters or game branding. This will be used as the map scene behind interactive HTML mission nodes, not as a flattened application screenshot.

## Next increment

Choose which backend feature to connect first. The original fourteen-day backend milestone plan remains pending; this frontend design increment does not mark those modules complete.

## Game interaction upgrade

All seven game enhancements are implemented. See [implementation, verification and asset prompt](GAME-ENHANCEMENTS.md).
