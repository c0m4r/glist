<img src="static/logo.svg" width="84" align="right" alt="glist logo">

# glist — personal games library

A self-hosted, zero-dependency web app for cataloguing your game collection
across stores and physical media.

## Features

- **Platforms per game**: Steam, GOG, EA (Origin), Ubisoft, Epic, and two
  kinds of physical copies — *original* (boxed) and *CD-Action* (magazine
  cover disc).
- **Store links**: the detail view links to the game's Steam page (exact,
  via app id) and to a title search on GOG / Epic / EA / Ubisoft for games
  on those platforms.
- **Search to add**: searches the public Steam store API (no API key needed)
  and pulls in cover art, description, genres, release date, developer and
  publisher automatically. Results already in your library are marked.
- **Manual entry**: for games not on Steam — title, cover URL, year, etc.
- **Custom covers**: upload your own cover image (jpg/png/gif/webp, max 10 MB)
  when adding a game manually, or via *Upload cover* in any game's detail
  view. Files are stored locally in `covers/` and cleaned up automatically
  when replaced or when the game is removed.
- **Library browsing**: filter chips per platform (with counts), instant
  text search, detail view with hero image, platform switching, deletion.
- **Deep links**: `#g<id>` opens a game's details, `#add` opens the add dialog.
- Responsive dark UI with blue accents — works on desktop and mobile.

## Running

```sh
python3 server.py
```

Then open <http://localhost:8420>. No dependencies — Python 3 stdlib only.
The library is stored in `glist.db` (SQLite) next to the server.

Change the port with `GLIST_PORT=9000 python3 server.py`.

## API

| Method | Path                  | Description                       |
|--------|-----------------------|-----------------------------------|
| GET    | `/api/games`          | list library                      |
| POST   | `/api/games`          | add a game                        |
| PUT    | `/api/games/<id>`     | update fields (e.g. platform)     |
| DELETE | `/api/games/<id>`     | remove a game                     |
| GET    | `/api/search?q=`      | search the Steam store (proxied)  |
| GET    | `/api/details?appid=` | full Steam metadata for one game  |
| POST   | `/api/upload`         | upload a cover image (raw body); returns `{url}` |

All game metadata (description, genres, release date, developer, publisher)
is fetched once when a game is added and stored in SQLite — browsing the
library never hits the Steam API. Cover and hero images are downloaded into
`covers/` when a game is added (and migrated for existing entries at
startup), so the whole library works offline. If a download fails, the
remote URL is kept and retried at the next startup.
