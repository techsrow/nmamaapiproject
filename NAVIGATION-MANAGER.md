# Navigation manager

Main admin route: /manage/navigation. Sidebar: Navigation Menus.

Create named menus with a unique lowercase handle, add CMS pages or custom links, rename link labels, drag items into order or submenus, and assign display positions. Arrow, Indent and Outdent controls work without drag-and-drop. Four levels and 200 items per menu are supported. Removing a parent removes its subtree, after confirmation. Menu/page visibility is independent of page content.

Positions: header, mobile, footer, footer-legal, top-bar. Saving a position moves it from the previously assigned menu in one transaction. Other positions remain assigned to their menus. A disabled menu retains its assignment but is unavailable to the storefront. Empty enabled menus are allowed.

## Migration and deployment

The new migration is 20261016110000_navigation_locations. It adds an empty locations array to existing NavigationMenu rows. It does not delete existing menus, pages or content. Existing menus have no assigned positions until an admin saves their positions. Preserve existing migration history and secrets.

In the deployed API directory:

```bash
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate status
# Review pending migrations, back up and rehearse them on staging first.
npx prisma migrate deploy
npm run build
npm test
pm2 list
# Use your actual API process name.
pm2 restart YOUR_API_PROCESS_NAME --update-env
pm2 save
```

Rebuild and publish the sibling admin/dist directory. A database migration and updated generated Prisma client are both required before using the new manager.

## Admin API (Admin authentication required)

- GET /api/content/navigation — all menus, including drafts/disabled menus and updatedAt revision.
- GET /api/content/navigation/pages — available CMS page IDs, titles, slugs and publication status.
- GET /api/content/navigation/locations — supported position names.
- PUT /api/content/navigation/:handle — create or save a complete menu.
- DELETE /api/content/navigation/:handle — delete with JSON expectedUpdatedAt.

Save payload example:

```json
{
  "name": "Main menu",
  "locations": ["header", "mobile"],
  "isActive": true,
  "items": [
    {"id":"home-link","label":"Home","type":"custom","url":"/","newTab":false,"isActive":true,"children":[]},
    {"id":"about-link","label":"About us","type":"page","pageId":1,"newTab":false,"isActive":true,"children":[]}
  ]
}
```

For an existing menu, also send its exact expectedUpdatedAt string obtained from the admin list/save response. Missing or stale revisions return 409. Reload rather than overwriting another edit. Handle stays fixed in the editor. New handles must be unique; menu names are also unique.

The old raw JSON POST/PATCH-by-ID compatibility routes have been removed so they cannot bypass validation or assignment locking. Legacy PUT /api/content/cms/navigation/:handle follows the new validation and revision contract. The editor converts common legacy label/title, url/href and children arrays into editable items; review and save them before publication. Non-list legacy data must be rebuilt; the public API fails closed for invalid legacy data.

## Public storefront contract

GET /api/content/navigation/location/header returns the active menu assigned to header. Other positions use the same path. GET /api/content/navigation/:handle and legacy GET /api/content/cms/navigation/:handle resolve an active menu directly.

Response shape:

```json
{"success":true,"data":{"handle":"main-menu","name":"Main menu","locations":["header"],"items":[{"id":"home-link","label":"Home","url":"/","newTab":false,"children":[]}]}}
```

Missing/disabled/invalid menus return 404. Unpublished or deleted CMS pages and invisible items are excluded together with their submenus. CMS page URLs resolve from the current published slug as /{slug}; the website must provide its CMS page route at this path. Updating a page slug requires no menu edit. Only safe HTTP(S), root-relative and anchor custom links are accepted. Render labels as text. Use target=_blank with rel=noopener noreferrer when newTab is true. Render children recursively and implement accessible mobile submenu controls. Fetch current menu data dynamically or revalidate it so saved changes appear on the website.

The main storefront has not been changed in this release. It will display these menus after its header/footer components are integrated with the public endpoints. Draft pages do not become public merely by adding a menu item.

## Verification

15 mocked API HTTP/schema scenarios, 4 tree-movement/legacy-conversion contract tests, 3 admin DOM interaction tests (including drag/drop and stale-save conflict), and 3 embedded PostgreSQL migration checks passed. Full API/admin builds and existing regression suites passed. Multi-client PostgreSQL lock contention and deployed-browser storefront rendering remain staging checks.

For isolated migration checks, use the same test-only PGlite installation described in DEPLOY-API.md:

```bash
PGLITE_MODULE=/tmp/namama-db-tests/node_modules/@electric-sql/pglite node tests/navigation-postgres.cjs
```
