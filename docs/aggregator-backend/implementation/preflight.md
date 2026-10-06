# BC-M1 kickoff preflight — October 6, 2026

Owner: current implementation lead. Requirement: AGENTS.md identity/ownership gates and ENG07. Evidence below was freshly observed before application edits.

| Check | Observed result | Limit |
| --- | --- | --- |
| Local source | Worktree HEAD, local main and origin/main all 87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f | Initial worktree clean, detached; isolated branch subsequently created |
| Primary checkout | HEAD same full SHA; git status --short empty | Read-only inspection; shared Git ref metadata necessarily lives in primary .git |
| GitHub main | Authenticated API branch main same full SHA | Fresh API read, not remote-tracking-ref inference |
| Planning PR | #286 OPEN draft, base main, head cef7f49243509da738ff9efc950538b5bd2ae3da | Only open PR returned in canonical repository at kickoff |
| Vercel production | league_one_fantasy, Robert Finchum's projects; ready deployment 8C3YSnXRCbmPETftQgRtirfyck5e; exact commit link 87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f | Authenticated in-app browser overview |
| Binding | clawmachinejed/league-one-audit; production branch main; root apps/site; include outside-root files enabled; Node 24.x | Overview repository link and Build and Deployment settings; nothing saved |
| Live identity | www.league1fantasy.com resolves to expected League One sign-in and League One/League Two/Dynasty public links | Identity check, not end-to-end target validation |
| Cron configuration | Enabled live-projections, lineup-observations and future-projections, each every minute | Matches committed vercel.json; no manual invocation |
| Natural activity | Current-lane HTTP200 entries at 2026-10-06T11:11–11:39Z; visible all-player preclaim not-due, upstreamRequests0 | Observed skip is not successful publication; other lanes/DB leases not yet directly inspected |
| Worktree/PR/deployment census | Existing historical worktrees retained; only open PR286; active production remains baseline; planning preview ready | No competing owner observed within this census. Live database/worker lease inventory unavailable without additional authorized access. No production ownership claimed |

No unexplained source/service disagreement was found. Production DB secrets were not fetched. Local SQL qualification configuration was absent in this worktree; control-file presence and process-variable names were inspected without logging secrets. See evidence.md for the resulting test gate.
