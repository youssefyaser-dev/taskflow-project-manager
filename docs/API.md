# TaskFlow API

All endpoints are JSON under `/api`. Send `Authorization: Bearer <token>` on everything except register and login.
Errors look like `{ "error": "message" }`. Resources outside your workspaces return 404, insufficient role returns 403.

## Roles
`viewer` < `member` < `admin` < `owner`. Viewers read. Members create and edit tasks, comments, time. Admins manage projects, invites and members. Only the owner manages admins.

| Method | Path | Min role | Notes |
|---|---|---|---|
| POST | /auth/register | public | Creates the user and a personal workspace. Rate limited. |
| POST | /auth/login | public | Rate limited. |
| GET | /me | any | Current user. |
| GET/POST | /workspaces | any | List yours, create one. |
| GET | /workspaces/:wid/members | viewer | |
| POST | /workspaces/:wid/invites | admin | `{email, role}` returns a one-time `code`. |
| GET | /workspaces/:wid/invites | admin | Pending invites. |
| POST | /invites/accept | any | `{code}`. Only the invited email can accept. |
| PATCH/DELETE | /workspaces/:wid/members/:uid | admin | Change role, remove. Members can remove themselves. |
| GET | /workspaces/:wid/activity | viewer | `?limit=` up to 100. |
| GET/POST | /workspaces/:wid/labels | viewer / member | |
| GET/POST | /workspaces/:wid/projects | viewer / admin | |
| DELETE | /projects/:id | admin | Cascades to tasks. |
| GET | /projects/:id/tasks | viewer | Filters: `status`, `priority`, `assignee` (id, `me`, `none`), `label`, `q`. |
| POST | /projects/:id/tasks | member | |
| GET | /tasks/:id | viewer | Includes labels, subtasks, time entries. |
| PATCH/DELETE | /tasks/:id | member | `position` is a float so drag and drop never renumbers a column. |
| PUT | /tasks/:id/labels | member | `{label_ids: []}` |
| POST | /tasks/:id/subtasks | member | PATCH/DELETE on `/subtasks/:id`. |
| POST | /tasks/:id/time | member | `{minutes, note}` |
| GET/POST | /tasks/:id/comments | viewer / member | `@name` mentions notify workspace members. |
| GET | /notifications | any | POST `/notifications/read` marks all read. |
| GET | /projects/:id/stats | viewer | Counts by status and priority, overdue, completion. |
| GET | /projects/:id/report | viewer | Burndown, workload, time per person. |
| GET | /projects/:id/export.csv | viewer | Spreadsheet formula characters are neutralised. |
