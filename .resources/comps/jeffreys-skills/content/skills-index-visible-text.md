Skip to content
Jeffrey's Skills.md
Install CLI
Browse Skills
Pricing
Docs
Help
Sign In
Browse Skills

Discover Claude Code skills to supercharge your workflow

Quality and Utility are curated catalog scores from canonical skill metadata. Community ratings appear separately as stars when reviews exist.

All Skills
Jeffrey's
Community
My Skills
All
Tools & Utilities
Agent & Orchestration
Code Quality
SaaS & Web Dev
DevOps & Infra
Research & Exploration
Rust
Flywheel Tool
UBS
BV
CASS
NTM
DCG
SLB
CM
RU
CAAM
Agent Mail
Difficulty
Beginner
Intermediate
Advanced
Expert
Filter by Tags
Python 3.x
TypeScript
React/Next.js
API design/development
Command-line tools
Docker/Containers
Show all tags
Showing 123 skills · Sorted by
Most installed
Sign in to save
SPECIALIZED
slack-migration-to-mattermost-phase-3-ongoing-maintenance

Keep a self-hosted Mattermost server healthy after the Phase 2 cutover. Use when running weekly health checks, applying OS security patches, upgrading Mattermost, taking and verifying PostgreSQL backups, scheduling reboots for off-hours windows, running quarterly restore drills, rotating credentials, responding to incidents, or executing disaster recovery against a lost host.

MM Phase 3 · Maintain
Nominal
Health
100
step 1/7
$ ./maintain.sh health
weekly
→ uptime 32d · queue 0 · latency p99 82ms · READY
Uptime
32 days
Checks
1/7
Cycle
0%
Quality
8.8
Quality
88
Usefulness
44
slack
mattermost
migration
Expert
83.4k
SIGN IN
2053
Sign in to save
CODE QUALITY
testing-metamorphic

Design and implement metamorphic testing for systems with the oracle problem. Use when: testing ML models, scientific computing, compilers, search engines, databases, graphics pipelines, or any system where correct output is unknown but input-output relationships are predictable. Metamorphic relations, property-based testing, MR taxonomy, oracle-free verification.

Metamorphic
8.7
SOURCE
"database"
1,247 results
FOLLOW-UP
"database index"
89 results
T: ADD AND TERM
✓
followUp ⊆ source
3 hold
2 violated
Quality
87
Usefulness
72
metamorphic-testing
oracle-problem
property-based-testing
Advanced
12.0k
SIGN IN
1746
Sign in to save
CODE QUALITY
deadlock-finder-and-fixer

Find and fix concurrency bugs - deadlocks, races, livelocks, await-holding-lock, database locks, LD_PRELOAD init, swarm races. Use when processes hang, tests flake, or auditing concurrency.

Deadlock Finder
HUNG
T1
Thread 1
T2
Thread 2
A
Mutex A
B
Mutex B

Both threads are blocked. The process is completely unresponsive.

9 classes
7 languages
14 incidents
9.5
Quality
95
Usefulness
85
concurrency
deadlock
race-condition
Advanced
107k
SIGN IN
1538
Sign in to save
SPECIALIZED
planning-workflow

Comprehensive markdown planning methodology for software projects. Use when starting a new project, creating implementation plans, or refining architecture before coding.

Plan
Scouting
Res
Des
Bld
Tst
Shp
1 / 5
$ grep -r 'TODO\|FIXME' docs/ | wc -l
~
plan.md
▶
Research
– Stakeholder interviews
– Competitor audit
– Tech spike
○
Design
○
Build
○
Test
○
Ship
~
timeline
Res
55%
Des
Bld
Tst
Shp
Phases
1 / 5
Progress
0%
Quality
7.0
Quality
70
Usefulness
82
planning
project-management
iterative-refinement
Beginner
3.9k
SIGN IN
1413
Sign in to save
AI/AGENT
vibing-with-ntm

Tends NTM agent swarms. Use when running orchestrator ticks, unsticking panes, handling rate limits, marching orders, review-only mode, convergence, queue-dry, or multi-agent coordination.

Loop idle.
vibing-with-ntm
READY
TRIAGE
CLAIM
DISP.
REVIEW
RECOV.
NTM
A
B
C
D
E
F
idle — waiting for triage
beads
0/1
9.2
Quality
92
Usefulness
80
multi-agent
orchestration
ntm
Advanced
66.9k
SIGN IN
1310
Sign in to save
AI/AGENT
ntm

Orchestrates NTM tmux agent swarms and robot APIs. Use when spawning/sending panes, reading robot state, triaging work, locks/mail, safety, pipelines, serve, or NTM errors.

Scene 1 of 4: Named swarms start cleanly
NTM
SPAWN
USER
ready
CC-1
booting
COD-1
booting
GMI-1
queued
SPAWN
DISPATCH
SNAPSHOT
SERVE
8.8
Quality
88
Usefulness
55
tmux
multi-agent
session-management
Intermediate
5.0
49.8k
SIGN IN
1310
Sign in to save
AI/AGENT
beads-workflow

Convert markdown plans into beads with dependencies using br CLI. Use when creating task graphs, polishing beads before implementation, or bridging planning to agent swarm execution.

Plan to Beads
Parsing
plan
0 beads
deps
$ bd parse plan.md --dry-run
plan.md
1
# Auth System Redesign
2
 
3
## Phase 1: Token Refresh
4
- Implement silent refresh flow
5
- Add retry logic with backoff
6
 
7
## Phase 2: Session Mgmt
8
- Build session store adapter
9
- Add multi-device tracking
10
 
11
## Phase 3: Migration
12
- Write data migration script
13
- Run E2E tests for new auth
bead graph
beads appear here
Beads
0
Pipeline
10%
Quality
7.6
Quality
76
Usefulness
43
task-management
planning
dependencies
Intermediate
5.7k
SIGN IN
1175
Sign in to save
AI/AGENT
cass

Mine past agent sessions for working prompts, decisions, and patterns. Use when "what did I ask?", "find that prompt", session archaeology, or agent history.

cass
AI/Agent
8.8
Quality
88
Usefulness
52
session-search
prompt-mining
cross-agent
Intermediate
42.5k
SIGN IN
1165
Sign in to save
SPECIALIZED
ui-polish

Iterative UI/UX polishing for Stripe-level visual quality. Use when app already works and looks decent, wanting to elevate to world-class through multiple passes. Not for complete overhauls.

UI Polish
Unpolished
Quality Score
30
/100
$ npx ui-audit --metrics spacing,contrast,type,consistency
Scanning UI for polish issues...
S
Spacing
28
BEFORE
C
Contrast
32
BEFORE
T
Typography
38
BEFORE
K
Consistency
24
BEFORE
Q
Overall
30
BEFORE
Pass
1/5
Polish
0%
before
in-progress
polished
0/5 done
Quality
7.4
Quality
74
Usefulness
64
ui-design
visual-quality
iteration
Intermediate
5.0
3.9k
SIGN IN
1149
Sign in to save
AI/AGENT
bd-to-br-migration

Migrate docs from bd (beads) to br (beads_rust). Use when updating AGENTS.md, converting bd commands, "bd sync" → "br sync --flush-only", or beads migration.

BD → BR
bd
→
br
bd sync
→
br sync --flush-only
bd create
→
br create
bd update
→
br update
bd close
→
br close
bd list
→
br list
Migrated
0/5
Quality
7.6
Quality
76
Usefulness
24
task-management
migration
beads
Intermediate
9.7k
SIGN IN
1131
Sign in to save
RUST
rch

Offload cargo/gcc/bun builds to remote workers. Use when compilation slow, "[RCH] local" in stderr, workers unhealthy, hook silent, sync fails, disk pressure, or SSH/daemon/telemetry recovery.

rch
Rust
Local
idle
Remote
waiting
Without rch
42s
With rch
...
8.7
Quality
87
Usefulness
26
remote-compilation
build-offloading
rust-builds
Intermediate
41.8k
SIGN IN
1084
Sign in to save
SPECIALIZED
idea-wizard

Generate and operationalize improvement ideas for projects. Use when brainstorming features, planning improvements, creating beads from ideas, or "what should we build next".

Ideas
Ideas
Brainstorm
Score
Prioritize
Create
Execute
$ # generating ideas from context + history
Brainstorming from context
✧
CLI auto-update
✧
Team dashboards
✧
Batch install
✧
AI suggestions
✧
Offline sync
7 ideas generated
Actioned
0/7
Quality
7.2
Quality
72
Usefulness
65
brainstorming
ideation
prioritization
Beginner
5.0
4.7k
SIGN IN
1082
Previous page unavailable
1
2
11
Next page
Jeffrey's Skills.md

The premier repository for high-performance Claude Code skills. Deterministic versioning, instant sync, and a developer-first CLI workflow.

JOIN NOW
INSTALL CLI

PRODUCT

Skill catalog
Pricing
Featured drops
Skill packs

DEVELOPERS

CLI Guide
CLI overview
Documentation
Help center
New to this? Start here
Support
System Status

LEGAL

Terms of Service
Privacy Policy
DMCA Policy

© 2026Jeffrey's Skills.md. All rights reserved.

BUILT FOR PROFESSIONAL DEVELOPERS.
